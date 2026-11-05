import logging
import mimetypes
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlsplit

import cloudinary
import cloudinary.uploader
from fastapi import HTTPException, UploadFile


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static", "uploads")
DEFAULT_MAX_UPLOAD_SIZE = 5 * 1024 * 1024
IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ATTACHMENT_CONTENT_TYPES = IMAGE_CONTENT_TYPES | {"application/pdf"}
LOCAL_FOLDER_MAP = {
    "campace/profiles": "avatars",
    "campace/ids": "id_cards",
    "campace/chat": "attachments",
    "campace/broadcasts": "broadcasts",
}
logger = logging.getLogger("app.storage")


def _cloudinary_configured() -> bool:
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    api_secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if not all((cloud_name, api_key, api_secret)):
        return False

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )
    return True


def _upload_metadata(file: UploadFile, content_types: set[str]) -> tuple[str, str, str, int]:
    filename = os.path.basename(file.filename or "upload")
    content_type = (file.content_type or mimetypes.guess_type(filename)[0] or "").split(";", 1)[0].strip().lower()
    if content_type not in content_types:
        raise HTTPException(status_code=400, detail="Unsupported upload content type.")

    stem = Path(filename).stem
    safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_-_") or "upload"
    extension = Path(filename).suffix.lower() or mimetypes.guess_extension(content_type) or ""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    public_id = f"{timestamp}_{uuid.uuid4().hex[:8]}_{safe_stem[:48]}"

    try:
        file.file.seek(0, os.SEEK_END)
        file_size = file.file.tell()
        file.file.seek(0)
    except (OSError, AttributeError) as error:
        raise HTTPException(status_code=400, detail="Unable to read uploaded file.") from error

    return content_type, extension, public_id, file_size


def _save_upload(
    file: UploadFile,
    folder: str,
    *,
    content_types: set[str],
    max_size_bytes: Optional[int],
    resource_type: str,
) -> str:
    content_type, extension, public_id, file_size = _upload_metadata(file, content_types)
    max_size = max_size_bytes if max_size_bytes is not None else DEFAULT_MAX_UPLOAD_SIZE
    if file_size > max_size:
        raise HTTPException(status_code=400, detail="Uploaded file exceeds the maximum allowed size.")

    if _cloudinary_configured():
        try:
            file.file.seek(0)
            upload_result = cloudinary.uploader.upload(
                file.file,
                public_id=public_id,
                folder=folder,
                resource_type=resource_type,
            )
            secure_url = upload_result.get("secure_url")
            if not secure_url:
                raise ValueError("Cloudinary response did not include a secure URL")
            return str(secure_url)
        except Exception as error:
            logger.error("Cloudinary upload failed for folder %s (%s).", folder, type(error).__name__)
            raise HTTPException(
                status_code=502,
                detail="Image storage service failed. Please try again later.",
            ) from error

    local_folder = LOCAL_FOLDER_MAP.get(folder, "")
    destination_dir = os.path.join(STATIC_DIR, local_folder) if local_folder else STATIC_DIR
    os.makedirs(destination_dir, exist_ok=True)
    local_filename = f"{public_id}{extension}"
    destination = os.path.join(destination_dir, local_filename)
    try:
        file.file.seek(0)
        with open(destination, "wb") as output_file:
            shutil.copyfileobj(file.file, output_file)
    except OSError as error:
        logger.error("Local upload save failed for folder %s (%s).", folder, type(error).__name__)
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.") from error

    relative_path = "/".join(part for part in (local_folder, local_filename) if part)
    return f"http://127.0.0.1:8000/static/uploads/{relative_path}"


def save_upload(
    file: UploadFile,
    folder: str,
    *,
    max_size_bytes: Optional[int] = None,
) -> str:
    """Persist a JPEG, PNG, or WebP upload and return its durable URL."""
    return _save_upload(
        file,
        folder,
        content_types=IMAGE_CONTENT_TYPES,
        max_size_bytes=max_size_bytes,
        resource_type="image",
    )


def delete_upload(url: str, folder: str) -> bool:
    """Delete an upload only when its URL belongs to the requested storage folder."""
    local_folder = LOCAL_FOLDER_MAP.get(folder)
    if not local_folder:
        raise ValueError(f"Unsupported upload folder: {folder}")

    parsed_url = urlsplit(str(url or "").strip())
    path = unquote(parsed_url.path)
    cloudinary_marker = "/image/upload/"
    if parsed_url.hostname == "res.cloudinary.com" and cloudinary_marker in path:
        if not _cloudinary_configured():
            raise HTTPException(status_code=503, detail="Image storage service is not configured.")

        encoded_public_id = path.split(cloudinary_marker, 1)[1]
        public_id_parts = encoded_public_id.split("/")
        if public_id_parts and re.fullmatch(r"v\d+", public_id_parts[0]):
            public_id_parts = public_id_parts[1:]
        if public_id_parts:
            public_id_parts[-1] = Path(public_id_parts[-1]).stem
        public_id = "/".join(public_id_parts)
        if not public_id.startswith(f"{folder}/"):
            return False

        try:
            result = cloudinary.uploader.destroy(public_id, resource_type="image")
        except Exception as error:
            logger.error("Cloudinary delete failed for folder %s (%s).", folder, type(error).__name__)
            raise HTTPException(status_code=502, detail="Image storage service failed to remove the photo.") from error
        if not isinstance(result, dict) or result.get("result") not in {"ok", "not found"}:
            raise HTTPException(status_code=502, detail="Image storage service could not remove the photo.")
        return True

    local_prefix = f"/static/uploads/{local_folder}/"
    if path.startswith(local_prefix):
        filename = path[len(local_prefix):]
        if not filename or os.path.basename(filename) != filename:
            return False
        root = os.path.realpath(os.path.join(STATIC_DIR, local_folder))
        target = os.path.realpath(os.path.join(root, filename))
        if os.path.commonpath([root, target]) != root:
            return False
        if os.path.isfile(target):
            os.remove(target)
            return True
        return False

    return False


def save_attachment(
    file: UploadFile,
    folder: str,
    *,
    max_size_bytes: Optional[int] = None,
) -> str:
    """Persist supported chat/support media using Cloudinary's matching resource type."""
    content_type = (file.content_type or mimetypes.guess_type(file.filename or "")[0] or "").split(";", 1)[0].strip().lower()
    is_media = content_type.startswith(("image/", "audio/", "video/"))
    if content_type != "application/pdf" and not is_media:
        raise HTTPException(status_code=400, detail="Unsupported attachment content type.")
    content_types = ATTACHMENT_CONTENT_TYPES | {content_type}
    resource_type = "raw" if content_type == "application/pdf" else "video" if content_type.startswith(("audio/", "video/")) else "image"
    return _save_upload(
        file,
        folder,
        content_types=content_types,
        max_size_bytes=max_size_bytes,
        resource_type=resource_type,
    )
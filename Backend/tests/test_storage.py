import io
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app import storage


def make_upload(filename="photo.jpg", content_type="image/jpeg", content=b"image-data"):
    return UploadFile(
        filename=filename,
        file=io.BytesIO(content),
        headers=Headers({"content-type": content_type}),
    )


class SaveUploadTests(unittest.TestCase):
    def setUp(self):
        self.cloudinary_env = {
            "CLOUDINARY_CLOUD_NAME": "test-cloud",
            "CLOUDINARY_API_KEY": "test-key",
            "CLOUDINARY_API_SECRET": "test-secret",
        }

    def test_cloudinary_success_returns_secure_url(self):
        upload = make_upload("campus photo.jpg")
        with patch.dict(os.environ, self.cloudinary_env, clear=True), patch.object(
            storage.cloudinary.uploader,
            "upload",
            return_value={"secure_url": "https://res.cloudinary.com/test/image/upload/test.jpg"},
        ) as cloudinary_upload:
            result = storage.save_upload(upload, "campace/products")

        self.assertEqual(result, "https://res.cloudinary.com/test/image/upload/test.jpg")
        self.assertEqual(cloudinary_upload.call_args.kwargs["folder"], "campace/products")
        self.assertEqual(cloudinary_upload.call_args.kwargs["resource_type"], "image")
        self.assertNotIn(" ", cloudinary_upload.call_args.kwargs["public_id"])

    def test_invalid_content_type_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            storage.save_upload(make_upload("document.pdf", "application/pdf"), "campace/products")

        self.assertEqual(raised.exception.status_code, 400)

    def test_oversize_upload_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            storage.save_upload(make_upload(content=b"too large"), "campace/products", max_size_bytes=3)

        self.assertEqual(raised.exception.status_code, 400)

    def test_missing_cloudinary_variables_falls_back_to_local_storage(self):
        with tempfile.TemporaryDirectory() as temporary_dir, patch.dict(os.environ, {}, clear=True), patch.object(
            storage,
            "STATIC_DIR",
            temporary_dir,
        ):
            result = storage.save_upload(make_upload(), "campace/products")

            self.assertTrue(result.startswith("http://127.0.0.1:8000/static/uploads/"))
            local_path = os.path.join(temporary_dir, result.rsplit("/", 1)[1])
            self.assertTrue(os.path.isfile(local_path))

    def test_cloudinary_error_returns_502_without_leaking_error(self):
        with patch.dict(os.environ, self.cloudinary_env, clear=True), patch.object(
            storage.cloudinary.uploader,
            "upload",
            side_effect=RuntimeError("private credential detail"),
        ):
            with self.assertRaises(HTTPException) as raised:
                storage.save_upload(make_upload(), "campace/products")

        self.assertEqual(raised.exception.status_code, 502)
        self.assertNotIn("private credential detail", raised.exception.detail)


class DeleteUploadTests(unittest.TestCase):
    def test_local_avatar_is_deleted_only_from_its_storage_folder(self):
        with tempfile.TemporaryDirectory() as temporary_dir, patch.object(
            storage,
            "STATIC_DIR",
            temporary_dir,
        ):
            avatar_dir = os.path.join(temporary_dir, "avatars")
            os.makedirs(avatar_dir)
            avatar_path = os.path.join(avatar_dir, "profile.webp")
            with open(avatar_path, "wb") as avatar:
                avatar.write(b"image-data")

            deleted = storage.delete_upload(
                "http://127.0.0.1:8000/static/uploads/avatars/profile.webp",
                "campace/profiles",
            )

        self.assertTrue(deleted)
        self.assertFalse(os.path.exists(avatar_path))

    def test_cloudinary_avatar_is_deleted_from_its_expected_folder(self):
        cloudinary_env = {
            "CLOUDINARY_CLOUD_NAME": "test-cloud",
            "CLOUDINARY_API_KEY": "test-key",
            "CLOUDINARY_API_SECRET": "test-secret",
        }
        with patch.dict(os.environ, cloudinary_env, clear=True), patch.object(
            storage.cloudinary.uploader,
            "destroy",
            return_value={"result": "ok"},
        ) as cloudinary_destroy:
            deleted = storage.delete_upload(
                "https://res.cloudinary.com/test/image/upload/v123/campace/profiles/photo.webp",
                "campace/profiles",
            )

        self.assertTrue(deleted)
        cloudinary_destroy.assert_called_once_with(
            "campace/profiles/photo",
            resource_type="image",
        )

    def test_cloudinary_avatar_outside_expected_folder_is_not_deleted(self):
        cloudinary_env = {
            "CLOUDINARY_CLOUD_NAME": "test-cloud",
            "CLOUDINARY_API_KEY": "test-key",
            "CLOUDINARY_API_SECRET": "test-secret",
        }
        with patch.dict(os.environ, cloudinary_env, clear=True), patch.object(
            storage.cloudinary.uploader,
            "destroy",
        ) as cloudinary_destroy:
            deleted = storage.delete_upload(
                "https://res.cloudinary.com/test/image/upload/v123/campace/products/photo.webp",
                "campace/profiles",
            )

        self.assertFalse(deleted)
        cloudinary_destroy.assert_not_called()


if __name__ == "__main__":
    unittest.main()
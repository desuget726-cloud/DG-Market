import asyncio
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SESSION_SECRET", "chapa-banks-test-secret")

from app import main as main_module


class StubChapaBanksResponse:
    is_error = False

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class StubChapaBanksClient:
    def __init__(self, response):
        self.response = response
        self.request_count = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, *_args, **_kwargs):
        self.request_count += 1
        return self.response


class ChapaBanksTests(unittest.TestCase):
    def setUp(self):
        self.original_cache = main_module._chapa_banks_cache
        self.original_expiry = main_module._chapa_banks_cache_expires_at
        self.original_cache_version = main_module._chapa_banks_cache_classification_version

    def tearDown(self):
        main_module._chapa_banks_cache = self.original_cache
        main_module._chapa_banks_cache_expires_at = self.original_expiry
        main_module._chapa_banks_cache_classification_version = self.original_cache_version

    def test_list_classifies_supported_mobile_codes_and_excludes_unsupported_wallets(self):
        main_module._chapa_banks_cache = [
            {"code": "855", "name": "Stale incorrectly-classified provider", "method": "bank"},
        ]
        main_module._chapa_banks_cache_expires_at = main_module.monotonic() + 3600
        main_module._chapa_banks_cache_classification_version = 1
        response = StubChapaBanksResponse({
            "data": [
                {"code": "855", "name": "telebirr"},
                {"code": "128", "name": "CBEBirr"},
                {"code": "266", "name": "M-Pesa"},
                {"code": "836", "name": "COOP Bank"},
                {"code": "867", "name": "YaYaWallet"},
            ],
        })
        client = StubChapaBanksClient(response)

        with patch.object(main_module.httpx, "AsyncClient", return_value=client), \
                patch.dict(os.environ, {"CHAPA_TEST_SECRET_KEY": "test-secret"}):
            banks = asyncio.run(main_module.get_chapa_banks())

        methods_by_code = {bank["code"]: bank["method"] for bank in banks}
        self.assertEqual(
            {code for code, method in methods_by_code.items() if method == "mobile_wallet"},
            {"128", "266", "855"},
        )
        self.assertEqual(
            {code for code, method in methods_by_code.items() if method == "bank"},
            {"836"},
        )
        self.assertNotIn("867", methods_by_code)
        mobile_names = {bank["name"] for bank in banks if bank["method"] == "mobile_wallet"}
        bank_names = {bank["name"] for bank in banks if bank["method"] == "bank"}
        self.assertEqual(mobile_names, {"telebirr", "CBEBirr", "M-Pesa"})
        self.assertEqual(bank_names, {"COOP Bank"})
        self.assertEqual(client.request_count, 1)
        self.assertEqual(
            main_module._chapa_banks_cache_classification_version,
            main_module._CHAPA_BANKS_CACHE_CLASSIFICATION_VERSION,
        )

    def test_mobile_money_number_requires_ethiopian_prefix_and_length(self):
        self.assertTrue(main_module._is_valid_mobile_money_number("0912345678"))
        self.assertTrue(main_module._is_valid_mobile_money_number("0712345678"))
        self.assertFalse(main_module._is_valid_mobile_money_number("0812345678"))
        self.assertFalse(main_module._is_valid_mobile_money_number("091234567"))

    def test_mobile_wallet_names_resolve_to_chapa_bank_codes(self):
        banks = [
            {"code": "855", "name": "telebirr", "method": "mobile_wallet"},
            {"code": "128", "name": "CBEBirr", "method": "mobile_wallet"},
            {"code": "266", "name": "M-Pesa", "method": "mobile_wallet"},
        ]

        for requested_name, expected_code in (
            ("telebirr", "855"),
            ("CBEBirr", "128"),
            ("M-Pesa", "266"),
        ):
            with self.subTest(requested_name=requested_name):
                bank = main_module._resolve_chapa_bank(banks, requested_name)
                self.assertEqual(bank["code"], expected_code)

    def test_only_essential_methods_resolve_and_cbe_code_comes_from_chapa_list(self):
        banks = [
            {"code": "901", "name": "Commercial Bank of Ethiopia", "method": "bank"},
            {"code": "855", "name": "telebirr", "method": "mobile_wallet"},
            {"code": "128", "name": "CBEBirr", "method": "mobile_wallet"},
            {"code": "266", "name": "M-Pesa", "method": "mobile_wallet"},
            {"code": "836", "name": "Cooperative Bank of Oromia", "method": "bank"},
        ]

        cbe = main_module._resolve_chapa_bank(
            banks, "901", "Commercial Bank of Ethiopia (CBE)", "bank"
        )
        telebirr = main_module._resolve_chapa_bank(
            banks, "Telebirr", "Telebirr", "mobile_wallet"
        )
        cbe_birr = main_module._resolve_chapa_bank(
            banks, "CBE Birr", "CBE Birr", "mobile_wallet"
        )

        self.assertEqual(cbe["code"], "901")
        self.assertEqual(telebirr["code"], "855")
        self.assertEqual(cbe_birr["code"], "128")
        self.assertIsNone(main_module._resolve_chapa_bank(
            banks, "266", "M-Pesa", "mobile_wallet"
        ))
        self.assertIsNone(main_module._resolve_chapa_bank(
            banks, "836", "Cooperative Bank of Oromia", "bank"
        ))

import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import codes  # noqa: E402


class Codes(unittest.TestCase):
    def test_personal_code_format(self):
        for role, prefix in (("francesco", "FRA"), ("marco", "MAR"), ("ambra", "AMB")):
            c = codes.new_code(role)
            self.assertRegex(c, r"^%s-[A-Z0-9]{4}-[A-Z0-9]{4}$" % prefix)
        self.assertNotEqual(codes.new_code("marco"), codes.new_code("marco"))

    def test_routine_key_is_long(self):
        self.assertGreaterEqual(len(codes.new_code("routine")), 40)

    def test_hash_is_sha256_hex(self):
        self.assertEqual(codes.code_hash("MAR-AAAA-BBBB"), hashlib.sha256(b"MAR-AAAA-BBBB").hexdigest())

    def test_unknown_role(self):
        with self.assertRaises(ValueError):
            codes.new_code("ospite")


if __name__ == "__main__":
    unittest.main()

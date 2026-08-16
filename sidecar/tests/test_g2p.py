"""Piper G2P unit checks (stdlib unittest, no NPU needed).

Run from the sidecar venv:  python -m unittest discover -s sidecar/tests -v
Skips when the Piper voice (and its cmudict.dict) is not downloaded yet.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("GENIEX_SIDECAR_HOME", str(Path(os.environ.get("APPDATA", str(Path.home()))) / "GenieX Studio" / "sidecar"))
os.environ.setdefault("GENIEX_SIDECAR_MODELS", os.environ["GENIEX_SIDECAR_HOME"] + os.sep + "models")

from engines.tts import PIPER_IDS, CmuDict, G2P, arpa_to_ipa, num_to_words  # noqa: E402
from registry import MODELS  # noqa: E402

CMUDICT = MODELS["piper-en"].dir / "cmudict.dict"
INV = {v: k for k, v in PIPER_IDS.items()}


def ipa_of(ids) -> str:
    return "".join(INV.get(int(i), "?") for i in ids)


class ArpaToIpa(unittest.TestCase):
    def test_espeak_conventions(self):
        self.assertEqual(arpa_to_ipa(["HH", "AH0", "L", "OW1"]), "həlˈoʊ")  # hello
        self.assertEqual(arpa_to_ipa(["W", "ER1", "L", "D"]), "wˈɜːld")  # world (stressed ER → ɜː)
        self.assertEqual(arpa_to_ipa(["D", "AO1", "G"]), "dˈɔːɡ")  # ɡ is U+0261, long ɔː
        self.assertEqual(arpa_to_ipa(["R", "EH1", "D"]), "ɹˈɛd")  # r → ɹ

    def test_numbers(self):
        self.assertEqual(num_to_words(0), "zero")
        self.assertEqual(num_to_words(42), "forty two")
        self.assertEqual(num_to_words(2026), "two thousand twenty six")
        self.assertEqual(num_to_words(1_000_000), "one million")


@unittest.skipUnless(CMUDICT.exists(), "piper-en voice not downloaded")
class TextToIds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g2p = G2P(CmuDict(CMUDICT))

    def test_interleaved_pads_and_bos_eos(self):
        ids = self.g2p.text_to_ids("Hello world.").tolist()
        self.assertEqual(ids[0], PIPER_IDS["^"])
        self.assertEqual(ids[1], PIPER_IDS["_"])
        self.assertEqual(ids[-1], PIPER_IDS["$"])
        # every phoneme is followed by PAD (piper-phonemize layout)
        body = ids[2:-1]
        self.assertTrue(all(body[i] == PIPER_IDS["_"] for i in range(1, len(body), 2)), body)
        self.assertEqual(ipa_of([p for p in body if p != PIPER_IDS["_"]]), "həlˈoʊ wˈɜːld.")

    def test_acronyms_and_camel_case(self):
        ph = lambda t: ipa_of([p for p in self.g2p.text_to_ids(t).tolist()[2:-1] if p != PIPER_IDS["_"]])  # noqa: E731
        self.assertEqual(ph("AI"), "ˈeɪ ˈaɪ")  # spelled, not the dictionary word "ai"
        self.assertTrue(ph("NPU").startswith("ˈɛn"))  # letters
        self.assertIn("nˈæsə", ph("NASA"))  # dictionary word kept
        self.assertEqual(ph("GenieX"), ph("Genie X"))  # camel-case split
        self.assertEqual(ph("X1E80100"), ph("X 1 E 80100"))

    def test_punctuation_and_length_guard(self):
        ids = self.g2p.text_to_ids("Wait, what? Yes!").tolist()
        for ch in ",?!":
            self.assertIn(PIPER_IDS[ch], ids)
        long = " ".join(["supercalifragilistic"] * 200)
        self.assertLessEqual(len(self.g2p.text_to_ids(long)), 512)


if __name__ == "__main__":
    unittest.main()

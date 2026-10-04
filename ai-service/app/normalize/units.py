"""Unit spelling normalization.

Labs print the same unit in many ways (`mg/dl`, `mg/dL`, `mg%`, `gm/dl`, `/cumm`,
`cells/cu.mm`, `x10³/µL`, `lakhs/cumm` ...). `unit_key()` maps them all to one
lowercase key so lab_tests.json can declare conversions once.
"""

from __future__ import annotations

import re

_SUPERSCRIPTS = str.maketrans({"³": "^3", "⁶": "^6", "⁹": "^9", "²": "2", "¹": "1", "²": "2"})

# Exact rewrites applied after basic cleanup (left → right).
_ALIASES: dict[str, str] = {
    "mg%": "mg/dl",
    "mgs/dl": "mg/dl",
    "mgm/dl": "mg/dl",
    "gm/dl": "g/dl",
    "gms/dl": "g/dl",
    "gm%": "g%",
    "gms%": "g%",
    "gm/l": "g/l",
    "iu/l": "u/l",
    "iu/ml": "u/ml",
    "units/l": "u/l",
    "unit/l": "u/l",
    "uiu/ml": "uiu/ml",
    "uu/ml": "uiu/ml",
    "miu/l": "uiu/ml",  # 1 mIU/L == 1 µIU/mL
    "ng/l": "pg/ml",    # 1 ng/L == 1 pg/mL
    "ug/l": "ng/ml",    # 1 µg/L == 1 ng/mL
    "fl": "fl",
    "femtoliters": "fl",
    "femtolitre": "fl",
    "picograms": "pg",
    "mm/1sthr": "mm/hr",
    "mm/1sthour": "mm/hr",
    "mm/hour": "mm/hr",
    "mm/h": "mm/hr",
    "mm at 1 hr": "mm/hr",
    "ml/min/1.73m2": "ml/min/1.73m2",
    "ml/min/1.73sqm": "ml/min/1.73m2",
    "ml/min/1.73m^2": "ml/min/1.73m2",
    "ml/min": "ml/min",
    "meq/l": "meq/l",
    "mmol/l": "mmol/l",
    "umol/l": "umol/l",
    "mmol/mol": "mmol/mol",
}


def unit_key(raw: str | None) -> str | None:
    """Normalize a printed unit to a lookup key (None if empty)."""
    if not raw:
        return None
    text = str(raw).strip().translate(_SUPERSCRIPTS).lower()
    text = text.replace("µ", "u").replace("μ", "u").replace("mcg", "ug").replace("mc/", "u/")
    text = re.sub(r"\s+", "", text)
    text = text.strip(".,;:()[]")
    if not text:
        return None
    # Cell-count denominators: cumm, cu.mm, cmm, mm3, mm^3, microlitre → /ul
    text = re.sub(r"(cells?|cell)?/(cu\.?mm|cmm|mm\^?3|ul|microlit(?:re|er)s?|mcl)$", "/ul", text)
    text = re.sub(r"^cells?/ul$", "/ul", text)
    # 10^3/ul spellings: x10^3/ul, 10e3/ul, 10*3/ul, thou/ul, k/ul, 10^3/cumm
    text = re.sub(r"^(x|\*)?10(\^|e|\*\*|\*)?3/ul$", "10^3/ul", text)
    text = re.sub(r"^(thou|thousands?|k)/ul$", "thousand/ul", text)
    text = re.sub(r"^(x|\*)?10(\^|e|\*\*|\*)?6/ul$", "10^6/ul", text)
    text = re.sub(r"^(millions?|mill|mil)/ul$", "million/ul", text)
    text = re.sub(r"^(lakhs?|lacs?)/ul$", "lakh/ul", text)
    text = re.sub(r"^(x|\*)?10(\^|e|\*\*|\*)?9/l$", "10^9/l", text)
    text = re.sub(r"^(x|\*)?10(\^|e|\*\*|\*)?12/l$", "10^12/l", text)
    # Common OCR confusions of µ and I: "plU/mL", "ylU/mL", "uIU/mL" → uiu/ml
    text = re.sub(r"^[pyu][il1|]u/m[l1]$", "uiu/ml", text)
    return _ALIASES.get(text, text)


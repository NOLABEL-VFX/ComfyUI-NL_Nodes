from __future__ import annotations


class NLRead:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "noop"
    CATEGORY = "NOLABEL/IO"
    OUTPUT_NODE = True

    def noop(self):
        return {}


class NLWrite:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "noop"
    CATEGORY = "NOLABEL/IO"
    OUTPUT_NODE = True

    def noop(self):
        return {}

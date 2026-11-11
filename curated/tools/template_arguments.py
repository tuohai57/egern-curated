"""Resolve whole numbered markers without matching marker 1 inside marker 10."""
import re


def substitute_markers(text, templates, defaults):
    def replace(match):
        marker = match.group(0)
        assert marker in templates, 'Unknown source marker: '+marker
        key = templates[marker][3:-3]
        assert key in defaults, 'Undeclared source argument: '+key
        value = defaults[key]
        return str(value).lower() if isinstance(value, bool) else str(value)
    return re.sub(r'NATIVE_RESTORE_TEMPLATE_[0-9]+', replace, text)

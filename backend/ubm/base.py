"""Extractor contract. Every format extractor implements the same three steps so the
service can treat all inputs uniformly (Open/Closed + Liskov): extract → validate →
convert_to_ubm. A registry maps a detected format to the right extractor."""
from __future__ import annotations

import abc
from typing import Any, Dict, List, Type

from .models import UniversalBuildingModel, ValidationIssue, ProjectMeta


class Extractor(abc.ABC):
    """One extractor per input family. `formats` lists the detect() tags it handles."""
    name: str = "extractor"
    formats: tuple[str, ...] = ()

    @abc.abstractmethod
    def extract(self, path: str) -> Dict[str, Any]:
        """Parse the raw file into an intermediate dict (format-specific)."""

    def validate(self, raw: Dict[str, Any]) -> List[ValidationIssue]:
        """Cheap pre-conversion sanity checks on the raw extraction (optional)."""
        return []

    @abc.abstractmethod
    def convert_to_ubm(self, raw: Dict[str, Any], meta: ProjectMeta) -> UniversalBuildingModel:
        """Normalise the intermediate into the Universal Building Model."""


_REGISTRY: Dict[str, Extractor] = {}


def register(cls: Type[Extractor]) -> Type[Extractor]:
    """Class decorator: instantiate the extractor once and index it by the formats it
    handles, so for_format() returns a ready instance."""
    inst = cls()
    for f in inst.formats:
        _REGISTRY[f] = inst
    return cls


def for_format(fmt: str) -> Extractor | None:
    return _REGISTRY.get(fmt)


def registry() -> Dict[str, Extractor]:
    return dict(_REGISTRY)

"""Shared pytest configuration and fixtures."""

import pytest
import sys
from pathlib import Path

# Ensure project root is on Python path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

pytest_plugins = ("pytest_asyncio",)


def pytest_configure(config):
    """Configure pytest-asyncio default fixture loop scope."""
    config.option.asyncio_mode = "auto"

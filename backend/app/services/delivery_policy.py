"""Environment guard applies at every mail transport boundary, including manual tests."""
import os


def require_delivery_enabled():
    if os.getenv('APP_ENV', 'production').lower() == 'beta' or os.getenv('EMAIL_DELIVERY_ENABLED', 'true').lower() != 'true':
        raise ValueError('Email delivery is disabled in this environment')

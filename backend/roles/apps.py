from django.apps import AppConfig


class RolesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'roles'
    verbose_name = 'Authentication & Authorization'
    
    def ready(self):
        """
        Initialize the app when Django starts
        """
        # Import signals if you have any
        try:
            from . import signals
        except ImportError:
            pass
        
        # Create default roles when app is ready
        try:
            from .utils import create_default_roles
            create_default_roles()
        except Exception:
            # Don't fail on startup if database isn't ready
            pass
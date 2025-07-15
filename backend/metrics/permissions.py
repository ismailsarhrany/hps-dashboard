# metrics/permissions.py
from django.contrib.auth.models import Group
from django.http import JsonResponse
from django.core.exceptions import PermissionDenied

class IsAdminUser:
    """Requires user to be in 'admin' group"""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Skip permission check for public endpoints
        public_paths = ['/health/', '/debug/']
        if any(request.path.startswith(path) for path in public_paths):
            return self.get_response(request)
            
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Authentication required"}, status=401)
        
        if not request.user.groups.filter(name='admin').exists():
            return JsonResponse({"error": "Admin privileges required"}, status=403)
            
        return self.get_response(request)

class IsAnalystOrAdmin:
    """Allows users in 'analyst' or 'admin' groups"""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
            
        return request.user.groups.filter(name__in=['admin', 'analyst']).exists()

def method_permission_classes(classes):
    def decorator(func):
        def wrapper(obj, request, *args, **kwargs):
            for cls in classes:
                if not cls().has_permission(request, obj):
                    raise PermissionDenied
            return func(obj, request, *args, **kwargs)
        return wrapper
    return decorator
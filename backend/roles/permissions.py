from rest_framework import permissions
from .models import Role


class IsAdminUser(permissions.BasePermission):
    """
    Custom permission to only allow admin users to access the resource.
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.role and
            request.user.role.name == Role.ADMIN
        )


class IsAnalystUser(permissions.BasePermission):
    """
    Custom permission to allow admin and analyst users to access the resource.
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.role and
            request.user.role.name in [Role.ADMIN, Role.ANALYST]
        )


class IsViewerUser(permissions.BasePermission):
    """
    Custom permission to allow all authenticated users with roles to access the resource.
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.role and
            request.user.role.name in [Role.ADMIN, Role.ANALYST, Role.VIEWER]
        )


class CanManageUsers(permissions.BasePermission):
    """
    Permission to manage users (Admin only)
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.has_admin_permissions()
        )


class CanConfigureAlerts(permissions.BasePermission):
    """
    Permission to configure alerts (Admin only)
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.has_admin_permissions()
        )


class CanRunModels(permissions.BasePermission):
    """
    Permission to run ML models (Admin and Analyst)
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.has_analyst_permissions()
        )


class CanViewDashboards(permissions.BasePermission):
    """
    Permission to view dashboards (All roles)
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.has_viewer_permissions()
        )


class CanExportData(permissions.BasePermission):
    """
    Permission to export data (Admin and Analyst)
    """
    
    def has_permission(self, request, view):
        return (
            request.user and 
            request.user.is_authenticated and 
            request.user.has_analyst_permissions()
        )


class RoleBasedPermission(permissions.BasePermission):
    """
    Generic role-based permission class
    """
    
    def __init__(self, required_roles=None):
        self.required_roles = required_roles or []
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        if not request.user.role:
            return False
        
        if not self.required_roles:
            return True
        
        return request.user.role.name in self.required_roles


# Permission decorators for function-based views
def require_admin(view_func):
    """
    Decorator to require admin role for function-based views
    """
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return permissions.PermissionDenied("Authentication required")
        
        if not request.user.has_admin_permissions():
            return permissions.PermissionDenied("Admin role required")
        
        return view_func(request, *args, **kwargs)
    
    return wrapper


def require_analyst(view_func):
    """
    Decorator to require analyst or admin role for function-based views
    """
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return permissions.PermissionDenied("Authentication required")
        
        if not request.user.has_analyst_permissions():
            return permissions.PermissionDenied("Analyst or Admin role required")
        
        return view_func(request, *args, **kwargs)
    
    return wrapper


def require_viewer(view_func):
    """
    Decorator to require any valid role for function-based views
    """
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return permissions.PermissionDenied("Authentication required")
        
        if not request.user.has_viewer_permissions():
            return permissions.PermissionDenied("Valid role required")
        
        return view_func(request, *args, **kwargs)
    
    return wrapper
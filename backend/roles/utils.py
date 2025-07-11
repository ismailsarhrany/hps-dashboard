from django.utils import timezone
from /pages.models import AuditLog


def get_client_ip(request):
    """
    Get client IP address from request
    """
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip


def log_user_activity(user, action, resource_type, ip_address, user_agent, resource_id=None, details=None):
    """
    Log user activity for audit purposes
    """
    AuditLog.objects.create(
        user=user,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent,
        details=details or {}
    )


def check_permission(user, permission_name):
    """
    Check if user has specific permission based on role
    """
    if not user or not user.is_authenticated or not user.role:
        return False
    
    role = user.role.name
    
    permission_map = {
        'admin': [
            'view_dashboards', 'manage_users', 'configure_alerts', 
            'run_models', 'export_data', 'view_audit_logs', 'manage_roles'
        ],
        'analyst': [
            'view_dashboards', 'run_models', 'export_data'
        ],
        'viewer': [
            'view_dashboards'
        ]
    }
    
    return permission_name in permission_map.get(role, [])


def get_user_permissions(user):
    """
    Get all permissions for a user based on their role
    """
    if not user or not user.is_authenticated or not user.role:
        return []
    
    role = user.role.name
    
    permission_map = {
        'admin': [
            'view_dashboards', 'manage_users', 'configure_alerts', 
            'run_models', 'export_data', 'view_audit_logs', 'manage_roles'
        ],
        'analyst': [
            'view_dashboards', 'run_models', 'export_data'
        ],
        'viewer': [
            'view_dashboards'
        ]
    }
    
    return permission_map.get(role, [])


def is_session_valid(session):
    """
    Check if user session is still valid
    """
    if not session or not session.is_active:
        return False
    
    # Check if session is older than 24 hours
    session_age = timezone.now() - session.last_activity
    if session_age.total_seconds() > 24 * 60 * 60:  # 24 hours
        session.is_active = False
        session.save()
        return False
    
    return True


def update_session_activity(session):
    """
    Update session last activity timestamp
    """
    if session:
        session.last_activity = timezone.now()
        session.save(update_fields=['last_activity'])


def create_default_roles():
    """
    Create default roles if they don't exist
    """
    from /pages.models import Role
    
    default_roles = [
        {
            'name': Role.ADMIN,
            'description': 'Full system access with all permissions including user management and system configuration.'
        },
        {
            'name': Role.ANALYST,
            'description': 'Data analysis access with dashboard viewing, model running, and data export capabilities.'
        },
        {
            'name': Role.VIEWER,
            'description': 'Read-only access to dashboards and basic monitoring features.'
        }
    ]
    
    for role_data in default_roles:
        Role.objects.get_or_create(
            name=role_data['name'],
            defaults={'description': role_data['description']}
        )


def validate_role_assignment(user, new_role):
    """
    Validate if a role can be assigned to a user
    """
    # Only admins can assign roles
    if not user.has_admin_permissions():
        return False, "Only administrators can assign roles"
    
    # Check if role exists
    from /pages.models import Role
    if not Role.objects.filter(name=new_role).exists():
        return False, "Role does not exist"
    
    return True, "Role assignment is valid"


def get_menu_items_for_role(role_name):
    """
    Get menu items based on user role
    """
    if not role_name:
        return []
    
    menu_items = {
        'admin': [
            {'name': 'Realtime Monitoring', 'route': '/pages/realtime', 'icon': 'activity'},
            {'name': 'Historic Dashboard', 'route': '/pages/historic', 'icon': 'trending-up'},
            {'name': 'Process Monitoring', 'route': '/process', 'icon': 'cpu'},
            {'name': 'User Management', 'route': '/users', 'icon': 'users'},
            {'name': 'Role Management', 'route': '/roles', 'icon': 'shield'},
            {'name': 'Alert Configuration', 'route': '/alerts', 'icon': 'bell'},
            {'name': 'Model Management', 'route': '/pages/models', 'icon': 'brain'},
            {'name': 'Reports', 'route': '/reports', 'icon': 'file-text'},
            {'name': 'Audit Logs', 'route': '/audit', 'icon': 'list'},
            {'name': 'Settings', 'route': '/settings', 'icon': 'settings'},
        ],
        'analyst': [
            {'name': 'Realtime Monitoring', 'route': '/pages/realtime', 'icon': 'activity'},
            {'name': 'Historic Dashboard', 'route': '/pages/historic', 'icon': 'trending-up'},
            {'name': 'Process Monitoring', 'route': '/pages/process', 'icon': 'cpu'},
            {'name': 'Model Management', 'route': '/pages/models', 'icon': 'brain'},
            {'name': 'Reports', 'route': '/reports', 'icon': 'file-text'},
            {'name': 'Data Export', 'route': '/export', 'icon': 'download'},
        ],
        'viewer': [
            {'name': 'Realtime Monitoring', 'route': '/pages/realtime', 'icon': 'activity'},
            {'name': 'Historic Dashboard', 'route': '/pages/historic', 'icon': 'trending-up'},
            {'name': 'Process Monitoring', 'route': '/pages/process', 'icon': 'cpu'},
        ]
    }
    
    return menu_items.get(role_name, [])
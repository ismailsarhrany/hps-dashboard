from django.utils.deprecation import MiddlewareMixin
from django.http import JsonResponse
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from .models import UserSession
from .utils import get_client_ip, update_session_activity, is_session_valid
import json

User = get_user_model()


class TokenAuthenticationMiddleware(MiddlewareMixin):
    """
    Custom token authentication middleware that also handles session management
    """
    
    def process_request(self, request):
        # Skip authentication for certain paths
        skip_paths = [
            '/api/auth/login/',
            '/api/auth/register/',
            '/admin/',
            '/static/',
            '/media/',
        ]
        
        if any(request.path.startswith(path) for path in skip_paths):
            return None
        
        # Get token from header
        auth_header = request.META.get('HTTP_AUTHORIZATION')
        if not auth_header or not auth_header.startswith('Token '):
            return None
        
        token_key = auth_header.split(' ')[1]
        
        try:
            token = Token.objects.get(key=token_key)
            user = token.user
            
            # Check if user is active
            if not user.is_active:
                return JsonResponse({'error': 'User account is disabled'}, status=401)
            
            # Get or create user session
            session = UserSession.objects.filter(
                user=user,
                session_key=token_key
            ).first()
            
            if session:
                # Check if session is valid
                if not is_session_valid(session):
                    return JsonResponse({'error': 'Session expired'}, status=401)
                
                # Update session activity
                update_session_activity(session)
            else:
                # Create new session
                UserSession.objects.create(
                    user=user,
                    session_key=token_key,
                    ip_address=get_client_ip(request),
                    user_agent=request.META.get('HTTP_USER_AGENT', '')
                )
            
            # Set user in request
            request.user = user
            request.auth = token
            
        except Token.DoesNotExist:
            return JsonResponse({'error': 'Invalid token'}, status=401)
        
        return None


class RoleBasedAccessMiddleware(MiddlewareMixin):
    """
    Middleware to check role-based access for specific endpoints
    """
    
    def process_request(self, request):
        # Skip for non-API requests
        if not request.path.startswith('/api/'):
            return None
        
        # Skip for authentication endpoints
        if request.path.startswith('/api/auth/'):
            return None
        
        # Skip if user is not authenticated
        if not hasattr(request, 'user') or not request.user.is_authenticated:
            return None
        
        # Check role-based access
        user = request.user
        path = request.path
        method = request.method
        
        # Admin-only endpoints
        admin_endpoints = [
            '/api/auth/users/',
            '/api/auth/roles/',
            '/api/auth/audit-logs/',
            '/api/auth/dashboard-stats/',
        ]
        
        # Analyst endpoints (Admin + Analyst)
        analyst_endpoints = [
            '/api/models/',
            '/api/reports/',
        ]
        
        # Check admin access
        if any(path.startswith(endpoint) for endpoint in admin_endpoints):
            if not user.has_admin_permissions():
                return JsonResponse({
                    'error': 'Admin access required',
                    'required_role': 'admin',
                    'user_role': user.get_role_name()
                }, status=403)
        
        # Check analyst access
        elif any(path.startswith(endpoint) for endpoint in analyst_endpoints):
            if not user.has_analyst_permissions():
                return JsonResponse({
                    'error': 'Analyst or Admin access required',
                    'required_role': 'analyst',
                    'user_role': user.get_role_name()
                }, status=403)
        
        # Check viewer access (all authenticated users with roles)
        elif path.startswith('/api/metrics/'):
            if not user.has_viewer_permissions():
                return JsonResponse({
                    'error': 'Valid role required',
                    'user_role': user.get_role_name()
                }, status=403)
        
        return None


class AuditLogMiddleware(MiddlewareMixin):
    """
    Middleware to log API requests for audit purposes
    """
    
    def process_response(self, request, response):
        # Skip for non-API requests
        if not request.path.startswith('/api/'):
            return response
        
        # Skip for authentication endpoints
        if request.path.startswith('/api/auth/login/') or request.path.startswith('/api/auth/register/'):
            return response
        
        # Skip if user is not authenticated
        if not hasattr(request, 'user') or not request.user.is_authenticated:
            return response
        
        # Skip GET requests for performance
        if request.method == 'GET':
            return response
        
        # Log the request
        from .utils import log_user_activity
        
        action_map = {
            'POST': 'create',
            'PUT': 'update',
            'PATCH': 'update',
            'DELETE': 'delete'
        }
        
        action = action_map.get(request.method, 'unknown')
        resource_type = self.get_resource_type(request.path)
        
        # Only log successful requests
        if 200 <= response.status_code < 300:
            log_user_activity(
                user=request.user,
                action=action,
                resource_type=resource_type,
                ip_address=get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', ''),
                details={
                    'method': request.method,
                    'path': request.path,
                    'status_code': response.status_code
                }
            )
        
        return response
    
    def get_resource_type(self, path):
        """
        Extract resource type from API path
        """
        if '/metrics/' in path:
            return 'metrics'
        elif '/users/' in path:
            return 'users'
        elif '/roles/' in path:
            return 'roles'
        elif '/models/' in path:
            return 'models'
        elif '/reports/' in path:
            return 'reports'
        else:
            return 'unknown'


class CORSMiddleware(MiddlewareMixin):
    """
    Custom CORS middleware for API requests
    """
    
    def process_response(self, request, response):
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        response['Access-Control-Allow-Credentials'] = 'true'
        
        return response
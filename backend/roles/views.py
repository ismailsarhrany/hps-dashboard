from rest_framework import status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.authtoken.models import Token
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.db import transaction
from django.conf import settings
from django.utils import timezone
from .models import CustomUser, Role, UserSession, AuditLog
from .serializers import (
    LoginSerializer, RegisterSerializer, UserSerializer, 
    ChangePasswordSerializer, UserProfileSerializer, 
    RoleSerializer, AuditLogSerializer
)
from .permissions import IsAdminUser, IsAnalystUser, IsViewerUser
from .utils import get_client_ip, log_user_activity
import json


class AuthenticationView(APIView):
    permission_classes = [permissions.AllowAny]
    
    @method_decorator(csrf_exempt)
    def post(self, request):
        if request.path.endswith('/login/'):
            return self.login(request)
        elif request.path.endswith('/register/'):
            return self.register(request)
        elif request.path.endswith('/logout/'):
            return self.logout(request)
    
    def login(self, request):
        serializer = LoginSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.validated_data['user']
            
            # Create or get token
            token, created = Token.objects.get_or_create(user=user)
            
            # Update last login IP
            user.last_login_ip = get_client_ip(request)
            user.save(update_fields=['last_login_ip'])
            
            # Create user session
            session = UserSession.objects.create(
                user=user,
                session_key=token.key,
                ip_address=get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')
            )
            
            # Log activity
            log_user_activity(
                user=user,
                action='login',
                resource_type='auth',
                ip_address=get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', ''),
                details={'session_id': session.id}
            )
            
            return Response({
                'token': token.key,
                'user': UserSerializer(user).data,
                'permissions': self.get_user_permissions(user)
            })
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    def register(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            with transaction.atomic():
                user = serializer.save()
                token, created = Token.objects.get_or_create(user=user)
                
                # Log activity
                log_user_activity(
                    user=user,
                    action='create',
                    resource_type='user',
                    ip_address=get_client_ip(request),
                    user_agent=request.META.get('HTTP_USER_AGENT', ''),
                    details={'registration': True}
                )
                
                return Response({
                    'token': token.key,
                    'user': UserSerializer(user).data,
                    'permissions': self.get_user_permissions(user)
                }, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    def logout(self, request):
        if request.user.is_authenticated:
            # Deactivate session
            UserSession.objects.filter(
                user=request.user,
                session_key=request.auth.key
            ).update(is_active=False)
            
            # Log activity
            log_user_activity(
                user=request.user,
                action='logout',
                resource_type='auth',
                ip_address=get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')
            )
            
            # Delete token
            request.auth.delete()
            
            return Response({'message': 'Successfully logged out'})
        
        return Response({'error': 'Not authenticated'}, status=status.HTTP_401_UNAUTHORIZED)
    
    def get_user_permissions(self, user):
        """Get user permissions based on role"""
        if not user.role:
            return {
                'can_view_dashboards': False,
                'can_manage_users': False,
                'can_configure_alerts': False,
                'can_run_models': False,
                'can_export_data': False
            }
        
        role = user.role.name
        
        if role == Role.ADMIN:
            return {
                'can_view_dashboards': True,
                'can_manage_users': True,
                'can_configure_alerts': True,
                'can_run_models': True,
                'can_export_data': True,
                'can_view_audit_logs': True,
                'can_manage_roles': True
            }
        elif role == Role.ANALYST:
            return {
                'can_view_dashboards': True,
                'can_manage_users': False,
                'can_configure_alerts': False,
                'can_run_models': True,
                'can_export_data': True,
                'can_view_audit_logs': False,
                'can_manage_roles': False
            }
        elif role == Role.VIEWER:
            return {
                'can_view_dashboards': True,
                'can_manage_users': False,
                'can_configure_alerts': False,
                'can_run_models': False,
                'can_export_data': False,
                'can_view_audit_logs': False,
                'can_manage_roles': False
            }
        
        return {}


class UserViewSet(ModelViewSet):
    queryset = CustomUser.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAdminUser]
    
    def get_permissions(self):
        """
        Instantiates and returns the list of permissions that this view requires.
        """
        if self.action in ['list', 'retrieve']:
            permission_classes = [IsAnalystUser]
        elif self.action in ['create', 'update', 'partial_update', 'destroy']:
            permission_classes = [IsAdminUser]
        elif self.action == 'profile':
            permission_classes = [permissions.IsAuthenticated]
        else:
            permission_classes = [IsAdminUser]
        
        return [permission() for permission in permission_classes]
    
    @action(detail=False, methods=['get', 'put'])
    def profile(self, request):
        """Get or update user profile"""
        if request.method == 'GET':
            serializer = UserProfileSerializer(request.user)
            return Response(serializer.data)
        
        elif request.method == 'PUT':
            serializer = UserProfileSerializer(request.user, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                
                # Log activity
                log_user_activity(
                    user=request.user,
                    action='update',
                    resource_type='profile',
                    ip_address=get_client_ip(request),
                    user_agent=request.META.get('HTTP_USER_AGENT', '')
                )
                
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def change_password(self, request):
        """Change user password"""
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            user = request.user
            user.set_password(serializer.validated_data['new_password'])
            user.save()
            
            # Log activity
            log_user_activity(
                user=user,
                action='update',
                resource_type='password',
                ip_address=get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')
            )
            
            return Response({'message': 'Password changed successfully'})
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class RoleViewSet(ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAdminUser]
    
    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            permission_classes = [IsAnalystUser]
        else:
            permission_classes = [IsAdminUser]
        
        return [permission() for permission in permission_classes]


class AuditLogViewSet(ModelViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminUser]
    http_method_names = ['get']  # Only allow read operations
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter parameters
        user_id = self.request.query_params.get('user_id')
        action = self.request.query_params.get('action')
        resource_type = self.request.query_params.get('resource_type')
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        if action:
            queryset = queryset.filter(action=action)
        if resource_type:
            queryset = queryset.filter(resource_type=resource_type)
        if start_date:
            queryset = queryset.filter(timestamp__gte=start_date)
        if end_date:
            queryset = queryset.filter(timestamp__lte=end_date)
        
        return queryset


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def check_auth(request):
    """Check if user is authenticated and return user info"""
    auth_view = AuthenticationView()
    return Response({
        'user': UserSerializer(request.user).data,
        'permissions': auth_view.get_user_permissions(request.user)
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def dashboard_stats(request):
    """Get dashboard statistics for admin"""
    stats = {
        'total_users': CustomUser.objects.count(),
        'active_users': CustomUser.objects.filter(is_active=True).count(),
        'total_sessions': UserSession.objects.filter(is_active=True).count(),
        'recent_logins': AuditLog.objects.filter(
            action='login',
            timestamp__gte=timezone.now() - timezone.timedelta(days=7)
        ).count(),
        'role_distribution': {}
    }
    
    # Get role distribution
    for role in Role.objects.all():
        stats['role_distribution'][role.name] = CustomUser.objects.filter(role=role).count()
    
    return Response(stats)
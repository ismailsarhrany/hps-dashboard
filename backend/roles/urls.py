from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AuthenticationView, UserViewSet, RoleViewSet, 
    AuditLogViewSet, check_auth, dashboard_stats
)

# Create router and register viewsets
router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'roles', RoleViewSet)
router.register(r'audit-logs', AuditLogViewSet)

# Authentication URLs
urlpatterns = [
    # Authentication endpoints
    path('login/', AuthenticationView.as_view(), name='login'),
    path('register/', AuthenticationView.as_view(), name='register'),
    path('logout/', AuthenticationView.as_view(), name='logout'),
    path('check-auth/', check_auth, name='check_auth'),
    
    # Dashboard stats
    path('dashboard-stats/', dashboard_stats, name='dashboard_stats'),
    
    # Include router URLs
    path('', include(router.urls)),
]
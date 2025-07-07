from django.contrib import admin

# Register your models here.
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.html import format_html
from .models import CustomUser, Role, UserSession, AuditLog


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'description', 'user_count', 'created_at']
    list_filter = ['name', 'created_at']
    search_fields = ['name', 'description']
    readonly_fields = ['created_at', 'updated_at']
    
    def user_count(self, obj):
        return obj.customuser_set.count()
    user_count.short_description = 'Users'


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = [
        'username', 'email', 'full_name', 'role', 'department', 
        'is_active', 'last_login', 'created_at'
    ]
    list_filter = ['role', 'department', 'is_active', 'is_staff', 'created_at']
    search_fields = ['username', 'email', 'full_name', 'department']
    readonly_fields = ['last_login', 'created_at', 'updated_at', 'last_login_ip']
    
    fieldsets = UserAdmin.fieldsets + (
        ('Profile Information', {
            'fields': ('full_name', 'phone', 'department', 'role')
        }),
        ('System Information', {
            'fields': ('last_login_ip', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Profile Information', {
            'fields': ('full_name', 'phone', 'department', 'role')
        }),
    )
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('role')


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'ip_address', 'is_active', 'created_at', 'last_activity'
    ]
    list_filter = ['is_active', 'created_at', 'last_activity']
    search_fields = ['user__username', 'ip_address']
    readonly_fields = ['session_key', 'created_at', 'last_activity']
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'action', 'resource_type', 'resource_id', 
        'ip_address', 'timestamp'
    ]
    list_filter = ['action', 'resource_type', 'timestamp']
    search_fields = [
        'user__username', 'resource_type', 'resource_id', 'ip_address'
    ]
    readonly_fields = ['timestamp']
    date_hierarchy = 'timestamp'
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')
    
    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False
    
    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
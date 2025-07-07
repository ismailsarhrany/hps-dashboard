from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from authentication.models import Role
from authentication.utils import create_default_roles

User = get_user_model()


class Command(BaseCommand):
    help = 'Create default roles and users for the system'
    
    def add_arguments(self, parser):
        parser.add_argument(
            '--admin-username',
            type=str,
            default='admin',
            help='Username for the admin user'
        )
        parser.add_argument(
            '--admin-password',
            type=str,
            default='admin123',
            help='Password for the admin user'
        )
        parser.add_argument(
            '--admin-email',
            type=str,
            default='admin@example.com',
            help='Email for the admin user'
        )
    
    def handle(self, *args, **options):
        self.stdout.write('Creating default roles and users...')
        
        # Create default roles
        create_default_roles()
        self.stdout.write(self.style.SUCCESS('✓ Default roles created'))
        
        # Get admin role
        admin_role = Role.objects.get(name=Role.ADMIN)
        analyst_role = Role.objects.get(name=Role.ANALYST)
        viewer_role = Role.objects.get(name=Role.VIEWER)
        
        # Create admin user
        admin_username = options['admin_username']
        admin_password = options['admin_password']
        admin_email = options['admin_email']
        
        if not User.objects.filter(username=admin_username).exists():
            admin_user = User.objects.create_user(
                username=admin_username,
                password=admin_password,
                email=admin_email,
                full_name='System Administrator',
                role=admin_role,
                is_superuser=True,
                is_staff=True
            )
            self.stdout.write(
                self.style.SUCCESS(f'✓ Admin user created: {admin_username}')
            )
        else:
            self.stdout.write(
                self.style.WARNING(f'⚠ Admin user already exists: {admin_username}')
            )
        
        # Create sample analyst user
        if not User.objects.filter(username='analyst').exists():
            analyst_user = User.objects.create_user(
                username='analyst',
                password='analyst123',
                email='analyst@example.com',
                full_name='Data Analyst',
                role=analyst_role,
                department='Data Science'
            )
            self.stdout.write(
                self.style.SUCCESS('✓ Sample analyst user created: analyst')
            )
        else:
            self.stdout.write(
                self.style.WARNING('⚠ Sample analyst user already exists')
            )
        
        # Create sample viewer user
        if not User.objects.filter(username='viewer').exists():
            viewer_user = User.objects.create_user(
                username='viewer',
                password='viewer123',
                email='viewer@example.com',
                full_name='Dashboard Viewer',
                role=viewer_role,
                department='Operations'
            )
            self.stdout.write(
                self.style.SUCCESS('✓ Sample viewer user created: viewer')
            )
        else:
            self.stdout.write(
                self.style.WARNING('⚠ Sample viewer user already exists')
            )
        
        self.stdout.write(self.style.SUCCESS('\n🎉 Setup completed successfully!'))
        self.stdout.write('\nDefault users created:')
        self.stdout.write(f'  Admin: {admin_username} / {admin_password}')
        self.stdout.write('  Analyst: analyst / analyst123')
        self.stdout.write('  Viewer: viewer / viewer123')
        self.stdout.write('\nYou can now use these credentials to login to the system.')
        
        # Print role information
        self.stdout.write('\n📋 Role Permissions:')
        self.stdout.write('  Admin: Full system access, user management, configuration')
        self.stdout.write('  Analyst: Dashboard access, model running, data export')
        self.stdout.write('  Viewer: Read-only dashboard access')
        
        # Security reminder
        self.stdout.write(self.style.WARNING('\n⚠️  SECURITY REMINDER:'))
        self.stdout.write(self.style.WARNING('Please change default passwords in production!'))
        self.stdout.write(self.style.WARNING('Use strong passwords and enable 2FA if available.'))
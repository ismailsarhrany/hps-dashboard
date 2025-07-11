# management/commands/create_sample_servers.py

from django.core.management.base import BaseCommand
from your_app.models import AIXServer

class Command(BaseCommand):
    help = 'Create sample AIX servers for testing'

    def handle(self, *args, **options):
        sample_servers = [
            {
                'name': 'AIX-PROD-01',
                'ip_address': '192.168.1.100',
                'username': 'root',
                'password': 'password123',
                'is_simulation': True,
                'simulation_interval': 30
            },
            {
                'name': 'AIX-PROD-02',
                'ip_address': '192.168.1.101',
                'username': 'admin',
                'password': 'admin123',
                'is_simulation': True,
                'simulation_interval': 45
            },
            {
                'name': 'AIX-TEST-01',
                'ip_address': '192.168.1.102',
                'username': 'testuser',
                'password': 'test123',
                'is_simulation': True,
                'simulation_interval': 60
            },
            {
                'name': 'AIX-REAL-01',
                'ip_address': '10.0.0.50',
                'username': 'monitor',
                'password': 'monitor123',
                'is_simulation': False,
                'simulation_interval': 30
            }
        ]

        created_count = 0
        for server_data in sample_servers:
            server, created = AIXServer.objects.get_or_create(
                name=server_data['name'],
                defaults=server_data
            )
            if created:
                created_count += 1
                self.stdout.write(
                    self.style.SUCCESS(f'Created server: {server.name}')
                )
            else:
                self.stdout.write(
                    self.style.WARNING(f'Server already exists: {server.name}')
                )

        self.stdout.write(
            self.style.SUCCESS(f'\nCreated {created_count} new servers')
        )
# management/commands/start_aix_simulation.py

from django.core.management.base import BaseCommand
from django.utils import timezone
from your_app.models import AIXServer
from your_app.services.aix_simulation_service import simulation_manager
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Start AIX server simulation for specified servers'

    def add_arguments(self, parser):
        parser.add_argument(
            '--server-id',
            type=int,
            help='Specific server ID to start simulation for'
        )
        parser.add_argument(
            '--server-name',
            type=str,
            help='Specific server name to start simulation for'
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Start simulation for all servers marked as simulation'
        )

    def handle(self, *args, **options):
        server_id = options.get('server_id')
        server_name = options.get('server_name')
        all_servers = options.get('all')

        if server_id:
            # Start simulation for specific server ID
            try:
                server = AIXServer.objects.get(id=server_id)
                success = simulation_manager.start_server_simulation(server.id)
                if success:
                    self.stdout.write(
                        self.style.SUCCESS(f'Started simulation for server {server.name}')
                    )
                else:
                    self.stdout.write(
                        self.style.ERROR(f'Failed to start simulation for server {server.name}')
                    )
            except AIXServer.DoesNotExist:
                self.stdout.write(
                    self.style.ERROR(f'Server with ID {server_id} not found')
                )

        elif server_name:
            # Start simulation for specific server name
            try:
                server = AIXServer.objects.get(name=server_name)
                success = simulation_manager.start_server_simulation(server.id)
                if success:
                    self.stdout.write(
                        self.style.SUCCESS(f'Started simulation for server {server.name}')
                    )
                else:
                    self.stdout.write(
                        self.style.ERROR(f'Failed to start simulation for server {server.name}')
                    )
            except AIXServer.DoesNotExist:
                self.stdout.write(
                    self.style.ERROR(f'Server with name {server_name} not found')
                )

        elif all_servers:
            # Start simulation for all servers
            servers = AIXServer.objects.filter(is_simulation=True)
            started = 0
            failed = 0

            for server in servers:
                try:
                    success = simulation_manager.start_server_simulation(server.id)
                    if success:
                        started += 1
                        self.stdout.write(f'Started simulation for {server.name}')
                    else:
                        failed += 1
                        self.stdout.write(f'Failed to start simulation for {server.name}')
                except Exception as e:
                    failed += 1
                    self.stdout.write(f'Error starting simulation for {server.name}: {e}')

            self.stdout.write(
                self.style.SUCCESS(f'Started {started} simulations, {failed} failed')
            )

        else:
            self.stdout.write(
                self.style.ERROR('Please specify --server-id, --server-name, or --all')
            )




# settings.py additions

# Add these to your Django settings.py

# Encryption key for password encryption
# Generate a key using: from cryptography.fernet import Fernet; Fernet.generate_key()
ENCRYPTION_KEY = b'your-generated-key-here'

# Logging configuration
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': 'aix_simulation.log',
        },
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
        },
    },
    'loggers': {
        'your_app.services.aix_simulation_service': {
            'handlers': ['file', 'console'],
            'level': 'INFO',
            'propagate': True,
        },
    },
}

"""
cryptography>=3.4.8
"""


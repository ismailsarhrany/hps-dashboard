# management/commands/stop_aix_simulation.py

from django.core.management.base import BaseCommand
from your_app.models import AIXServer
from your_app.services.aix_simulation_service import simulation_manager

class Command(BaseCommand):
    help = 'Stop AIX server simulation'

    def add_arguments(self, parser):
        parser.add_argument(
            '--server-id',
            type=int,
            help='Specific server ID to stop simulation for'
        )
        parser.add_argument(
            '--server-name',
            type=str,
            help='Specific server name to stop simulation for'
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Stop all running simulations'
        )

    def handle(self, *args, **options):
        server_id = options.get('server_id')
        server_name = options.get('server_name')
        all_servers = options.get('all')

        if server_id:
            # Stop simulation for specific server ID
            try:
                server = AIXServer.objects.get(id=server_id)
                simulation_manager.stop_server_simulation(server.id)
                self.stdout.write(
                    self.style.SUCCESS(f'Stopped simulation for server {server.name}')
                )
            except AIXServer.DoesNotExist:
                self.stdout.write(
                    self.style.ERROR(f'Server with ID {server_id} not found')
                )

        elif server_name:
            # Stop simulation for specific server name
            try:
                server = AIXServer.objects.get(name=server_name)
                simulation_manager.stop_server_simulation(server.id)
                self.stdout.write(
                    self.style.SUCCESS(f'Stopped simulation for server {server.name}')
                )
            except AIXServer.DoesNotExist:
                self.stdout.write(
                    self.style.ERROR(f'Server with name {server_name} not found')
                )

        elif all_servers:
            # Stop all simulations
            simulation_manager.stop_all_simulations()
            self.stdout.write(
                self.style.SUCCESS('Stopped all simulations')
            )

        else:
            self.stdout.write(
                self.style.ERROR('Please specify --server-id, --server-name, or --all')
            )


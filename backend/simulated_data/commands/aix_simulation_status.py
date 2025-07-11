# management/commands/aix_simulation_status.py

from django.core.management.base import BaseCommand
from your_app.models import AIXServer
from your_app.services.aix_simulation_service import simulation_manager

class Command(BaseCommand):
    help = 'Check AIX server simulation status'

    def handle(self, *args, **options):
        servers = AIXServer.objects.all()
        
        self.stdout.write(
            self.style.SUCCESS('\nAIX Server Simulation Status:')
        )
        self.stdout.write('=' * 80)
        
        for server in servers:
            is_running = simulation_manager.get_simulation_status(server.id)
            status_color = self.style.SUCCESS if is_running else self.style.WARNING
            
            self.stdout.write(
                f'{server.name:<20} | {server.ip_address:<15} | '
                f'{server.status:<10} | {status_color("Running" if is_running else "Stopped")}'
            )
        
        running_count = sum(1 for server in servers 
                           if simulation_manager.get_simulation_status(server.id))
        
        self.stdout.write('=' * 80)
        self.stdout.write(
            f'Total servers: {len(servers)}, Running simulations: {running_count}'
        )

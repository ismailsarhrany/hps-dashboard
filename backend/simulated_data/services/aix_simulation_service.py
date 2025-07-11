# services/aix_simulation_service.py

import threading
import time
import random
import logging
from datetime import datetime, timedelta
from django.utils import timezone
from typing import Dict, List, Optional
import paramiko
import json
from  metrics.producers.metric_producer import MetricProducer

logger = logging.getLogger(__name__)

class AIXServerSimulator:
    """Simulates AIX server metrics collection via SSH"""
    
    def __init__(self, server):
        self.server = server
        self.is_running = False
        self.thread = None
        self.ssh_client = None
        self.collection_session = None
        self.producer = MetricProducer()
        
        # Simulation state for realistic data generation
        self.simulation_state = {
            'cpu_base': random.uniform(10, 30),
            'memory_base': random.uniform(40, 70),
            'disk_activity': random.uniform(0.1, 2.0),
            'network_activity': random.uniform(100, 1000),
            'process_count': random.randint(50, 200)
        }
    
    def start_simulation(self):
        """Start the simulation thread"""
        if not self.is_running:
            self.is_running = True
            self.thread = threading.Thread(target=self._simulation_loop)
            self.thread.daemon = True
            self.thread.start()
            logger.info(f"Started simulation for server {self.server.name}")
            
            # Create collection session
            from .models import ServerMetricCollection
            self.collection_session = ServerMetricCollection.objects.create(
                server=self.server
            )
    
    def stop_simulation(self):
        """Stop the simulation thread"""
        self.is_running = False
        if self.thread:
            self.thread.join(timeout=5)
        
        if self.collection_session:
            self.collection_session.ended_at = timezone.now()
            self.collection_session.is_active = False
            self.collection_session.save()
        
        logger.info(f"Stopped simulation for server {self.server.name}")
    
    def _simulation_loop(self):
        """Main simulation loop"""
        while self.is_running:
            try:
                timestamp = timezone.now()
                
                # Simulate SSH connection and data collection
                if self.server.is_simulation:
                    self._simulate_ssh_connection()
                    self._collect_metrics(timestamp)
                else:
                    self._real_ssh_connection()
                    self._collect_real_metrics(timestamp)
                
                # Update collection session
                if self.collection_session:
                    self.collection_session.total_metrics_collected += 4  # vmstat, iostat, netstat, process
                    self.collection_session.save()
                
                # Wait for next collection
                time.sleep(self.server.simulation_interval)
                
            except Exception as e:
                logger.error(f"Error in simulation loop for {self.server.name}: {e}")
                time.sleep(5)  # Wait before retrying
    
    def _simulate_ssh_connection(self):
        """Simulate SSH connection status"""
        # Randomly simulate connection issues (5% chance)
        if random.random() < 0.05:
            self.server.status = 'error'
            time.sleep(2)  # Simulate reconnection delay
        else:
            self.server.status = 'active'
            self.server.last_connected = timezone.now()
        
        self.server.save()
    
    def _collect_metrics(self, timestamp):
        """Collect simulated metrics"""
        self._generate_vmstat_metrics(timestamp)
        self._generate_iostat_metrics(timestamp)
        self._generate_netstat_metrics(timestamp)
        self._generate_process_metrics(timestamp)
    
    def _generate_vmstat_metrics(self, timestamp):
        """Generate realistic vmstat metrics"""
        from .models import VmstatMetric
        
        # Add some randomness to base values
        cpu_usage = max(0, self.simulation_state['cpu_base'] + random.uniform(-10, 20))
        memory_usage = max(0, self.simulation_state['memory_base'] + random.uniform(-15, 15))
        
        # Generate realistic values
        r = random.randint(0, 5)  # Run queue
        b = random.randint(0, 2)  # Blocked processes
        avm = int(random.uniform(800000, 1200000))  # Active virtual memory
        fre = int(random.uniform(200000, 600000))   # Free memory
        pi = random.randint(0, 100)  # Pages in
        po = random.randint(0, 50)   # Pages out
        fr = random.randint(0, 20)   # Page faults
        interface_in = random.randint(10, 1000)  # Interrupts
        cs = random.randint(100, 2000)  # Context switches
        us = min(100, cpu_usage)  # User CPU
        sy = min(100, random.uniform(5, 20))  # System CPU
        idle = max(0, 100 - us - sy)  # Idle CPU
        
        VmstatMetric.objects.create(
            server=self.server,
            timestamp=timestamp,
            r=r, b=b, avm=avm, fre=fre, pi=pi, po=po, fr=fr,
            interface_in=interface_in, cs=cs, us=us, sy=sy, idle=idle
        )
    
    def _generate_iostat_metrics(self, timestamp):
        """Generate realistic iostat metrics"""
        from .models import IostatMetric
        
        # Common AIX disk names
        disks = ['hdisk0', 'hdisk1', 'hdisk2', 'hdisk3']
        
        for disk in disks:
            tps = self.simulation_state['disk_activity'] + random.uniform(-0.5, 1.5)
            kb_read = max(0, tps * random.uniform(10, 100))
            kb_wrtn = max(0, tps * random.uniform(5, 80))
            service_time = random.uniform(0.1, 10.0)
            
            IostatMetric.objects.create(
                server=self.server,
                timestamp=timestamp,
                disk=disk,
                tps=round(tps, 2),
                kb_read=round(kb_read, 2),
                kb_wrtn=round(kb_wrtn, 2),
                service_time=round(service_time, 2)
            )
    
    def _generate_netstat_metrics(self, timestamp):
        """Generate realistic netstat metrics"""
        from .models import NetstatMetric
        
        # Common AIX network interfaces
        interfaces = ['en0', 'en1', 'lo0']
        
        for interface in interfaces:
            base_packets = self.simulation_state['network_activity']
            if interface == 'lo0':
                base_packets *= 0.1  # Loopback has less traffic
            
            ipkts = int(base_packets + random.uniform(-100, 200))
            ierrs = random.randint(0, 5)
            ipkts_rate = round(ipkts / 30.0, 2)  # Per second rate
            ierrs_rate = round(ierrs / 30.0, 4)
            opkts = int(base_packets * 0.8 + random.uniform(-80, 150))
            opkts_rate = round(opkts / 30.0, 2)
            oerrs = random.randint(0, 3)
            oerrs_rate = round(oerrs / 30.0, 4)
            
            NetstatMetric.objects.create(
                server=self.server,
                timestamp=timestamp,
                interface=interface,
                ipkts=ipkts,
                ierrs=ierrs,
                ipkts_rate=ipkts_rate,
                ierrs_rate=ierrs_rate,
                opkts=opkts,
                opkts_rate=opkts_rate,
                oerrs=oerrs,
                oerrs_rate=oerrs_rate,
                time=int(timestamp.timestamp())
            )
    
    def _generate_process_metrics(self, timestamp):
        """Generate realistic process metrics"""
        from .models import ProcessMetric
        
        # Common AIX processes
        common_processes = [
            'init', 'kproc', 'wait', 'lrud', 'syncd', 'errdemon',
            'cron', 'sendmail', 'sshd', 'getty', 'httpd', 'db2sysc',
            'oracle', 'java', 'python', 'perl', 'sh', 'ksh'
        ]
        
        # Generate 10-20 process entries
        num_processes = random.randint(10, 20)
        
        for i in range(num_processes):
            pid = random.randint(1, 32768)
            user = random.choice(['root', 'daemon', 'bin', 'sys', 'adm', 'oracle', 'db2inst1'])
            command = random.choice(common_processes)
            
            # CPU and memory usage
            cpu = random.uniform(0, 25)
            mem = random.uniform(0.1, 15)
            
            ProcessMetric.objects.create(
                server=self.server,
                timestamp=timestamp,
                pid=pid,
                user=user,
                cpu=round(cpu, 2),
                mem=round(mem, 2),
                command=command
            )
    
    def _real_ssh_connection(self):
        """Establish real SSH connection"""
        try:
            if not self.ssh_client:
                self.ssh_client = paramiko.SSHClient()
                self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            self.ssh_client.connect(
                hostname=self.server.ip_address,
                port=self.server.port,
                username=self.server.username,
                password=self.server.decrypt_password(),
                timeout=30
            )
            
            self.server.status = 'active'
            self.server.last_connected = timezone.now()
            self.server.save()
            
        except Exception as e:
            logger.error(f"SSH connection failed for {self.server.name}: {e}")
            self.server.status = 'error'
            self.server.save()
            if self.ssh_client:
                self.ssh_client.close()
                self.ssh_client = None
    
    def _collect_real_metrics(self, timestamp):
        """Collect real metrics via SSH"""
        if not self.ssh_client:
            return
        
        try:
            # Execute vmstat command
            stdin, stdout, stderr = self.ssh_client.exec_command('vmstat 1 1')
            vmstat_output = stdout.read().decode()
            self._parse_vmstat_output(vmstat_output, timestamp)
            
            # Execute iostat command
            stdin, stdout, stderr = self.ssh_client.exec_command('iostat 1 1')
            iostat_output = stdout.read().decode()
            self._parse_iostat_output(iostat_output, timestamp)
            
            # Execute netstat command
            stdin, stdout, stderr = self.ssh_client.exec_command('netstat -i')
            netstat_output = stdout.read().decode()
            self._parse_netstat_output(netstat_output, timestamp)
            
            # Execute ps command
            stdin, stdout, stderr = self.ssh_client.exec_command('ps aux | head -20')
            ps_output = stdout.read().decode()
            self._parse_ps_output(ps_output, timestamp)
            
        except Exception as e:
            logger.error(f"Error collecting real metrics for {self.server.name}: {e}")
    
    def _parse_vmstat_output(self, output, timestamp):
        """Parse vmstat command output"""
        # Implementation depends on AIX vmstat format
        # This is a placeholder - implement based on actual AIX vmstat output
        pass
    
    def _parse_iostat_output(self, output, timestamp):
        """Parse iostat command output"""
        # Implementation depends on AIX iostat format
        pass
    
    def _parse_netstat_output(self, output, timestamp):
        """Parse netstat command output"""
        # Implementation depends on AIX netstat format
        pass
    
    def _parse_ps_output(self, output, timestamp):
        """Parse ps command output"""
        # Implementation depends on AIX ps format
        pass


class AIXSimulationManager:
    """Manages multiple AIX server simulators"""
    
    def __init__(self):
        self.simulators = {}
    
    def start_server_simulation(self, server_id):
        """Start simulation for a specific server"""
        from .models import AIXServer
        
        try:
            server = AIXServer.objects.get(id=server_id)
            if server_id not in self.simulators:
                self.simulators[server_id] = AIXServerSimulator(server)
            
            self.simulators[server_id].start_simulation()
            return True
        except AIXServer.DoesNotExist:
            logger.error(f"Server with ID {server_id} not found")
            return False
    
    def stop_server_simulation(self, server_id):
        """Stop simulation for a specific server"""
        if server_id in self.simulators:
            self.simulators[server_id].stop_simulation()
            del self.simulators[server_id]
    
    def stop_all_simulations(self):
        """Stop all running simulations"""
        for server_id in list(self.simulators.keys()):
            self.stop_server_simulation(server_id)
    
    def get_simulation_status(self, server_id):
        """Get simulation status for a server"""
        if server_id in self.simulators:
            return self.simulators[server_id].is_running
        return False


# Global simulation manager instance
simulation_manager = AIXSimulationManager()
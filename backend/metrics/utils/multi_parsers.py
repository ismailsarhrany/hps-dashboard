import re
from datetime import datetime
from typing import Dict, List, Any
import platform

def parse_vmstat(output: str, os_type: str, timestamp: datetime) -> Dict[str, Any]:
    """
    Parse vmstat output from different OS and convert to standardized format
    Standard fields: r, b, avm, fre, pi, po, fr, interface_in, cs, us, sy, idle
    """
    lines = output.strip().split('\n')
    os_type = os_type.lower()
    
    if os_type == 'linux':
        for line in lines:
            if re.match(r'^\s*\d+\s+\d+', line):
                fields = line.split()
                return {
                    'timestamp': timestamp,
                    'r': int(fields[0]),
                    'b': int(fields[1]),
                    'avm': int(fields[2]),  # swpd (swap used)
                    'fre': int(fields[3]),  # free memory
                    'pi': int(fields[5]),   # si (swap in)
                    'po': int(fields[6]),   # so (swap out)
                    'fr': int(fields[7]),   # bi (blocks in)
                    'interface_in': int(fields[10]),  # in (interrupts)
                    'cs': int(fields[11]),  # cs (context switches)
                    'us': float(fields[12]), 
                    'sy': float(fields[13]),
                    'idle': float(fields[14]),
                }
    
    elif os_type == 'sunos':  # Solaris
        for line in lines:
            if re.match(r'^\s*\d+\s+\d+\s+\d+', line):
                fields = line.split()
                return {
                    'timestamp': timestamp,
                    'r': int(fields[0]),
                    'b': int(fields[1]),
                    'avm': int(fields[3]),  # swap
                    'fre': int(fields[4]),  # free
                    'pi': int(fields[7]),   # pi (page in)
                    'po': int(fields[8]),   # po (page out)
                    'fr': int(fields[9]),   # fr (page freed)
                    'interface_in': int(fields[16]), 
                    'cs': int(fields[18]),
                    'us': float(fields[19]),
                    'sy': float(fields[20]),
                    'idle': float(fields[21]),
                }
    
    # AIX format (default)
    for line in lines:
        if re.match(r'^\s*\d+\s+\d+', line):
            fields = line.split()
            return {
                'timestamp': timestamp,
                'r': int(fields[0]),
                'b': int(fields[1]),
                'avm': int(fields[2]),
                'fre': int(fields[3]),
                'pi': int(fields[4]),
                'po': int(fields[5]),
                'fr': int(fields[6]),
                'interface_in': int(fields[7]),
                'cs': int(fields[8]),
                'us': float(fields[9]),
                'sy': float(fields[10]),
                'idle': float(fields[11]),
            }
    
    return {}

def parse_iostat(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
    """
    Parse iostat output and convert to standardized format
    Standard fields: disk, tps, kb_read, kb_wrtn, service_time
    """
    lines = output.strip().split('\n')
    devices = []
    os_type = os_type.lower()
    
    if os_type == 'linux':
        in_device_section = False
        for line in lines:
            if 'Device' in line and 'tps' in line:
                in_device_section = True
                continue
            if in_device_section and line.strip():
                fields = line.split()
                if len(fields) >= 5:
                    devices.append({
                        'timestamp': timestamp,
                        'disk': fields[0],
                        'tps': float(fields[1]),
                        'kb_read': float(fields[4]),
                        'kb_wrtn': float(fields[5]),
                        'service_time': 0.0,
                    })
    
    elif os_type == 'sunos':  # Solaris
        in_device_section = False
        for line in lines:
            if 'device' in line and 'r/s' in line:
                in_device_section = True
                continue
            if in_device_section and line.strip():
                fields = line.split()
                if len(fields) >= 9:
                    devices.append({
                        'timestamp': timestamp,
                        'disk': fields[0],
                        'tps': float(fields[1]) + float(fields[2]),
                        'kb_read': float(fields[3]),
                        'kb_wrtn': float(fields[4]),
                        'service_time': float(fields[7]),
                    })
    
    return devices

def parse_netstat(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
    """
    Parse netstat -i -n output and convert to standardized format
    Standard fields: interface, ipkts, ierrs, opkts, oerrs
    """
    lines = output.strip().split('\n')
    interfaces = []
    os_type = os_type.lower()
    
    if os_type == 'linux':
        header_found = False
        for line in lines:
            if 'Iface' in line and 'RX-OK' in line:
                header_found = True
                continue
            if header_found and line.strip():
                fields = line.split()
                if len(fields) >= 11:
                    interfaces.append({
                        'timestamp': timestamp,
                        'interface': fields[0],
                        'ipkts': int(fields[3]),      # RX-OK
                        'ierrs': int(fields[4]),      # RX-ERR
                        'opkts': int(fields[7]),      # TX-OK
                        'oerrs': int(fields[8]),      # TX-ERR
                    })
    
    elif os_type == 'sunos':  # Solaris
        header_found = False
        for line in lines:
            if 'Name' in line and 'Ipkts' in line:
                header_found = True
                continue
            if header_found and line.strip():
                fields = line.split()
                if len(fields) >= 8:
                    interfaces.append({
                        'timestamp': timestamp,
                        'interface': fields[0],
                        'ipkts': int(fields[4]),      # Ipkts
                        'ierrs': int(fields[5]),      # Ierrs
                        'opkts': int(fields[6]),      # Opkts
                        'oerrs': int(fields[7]),      # Oerrs
                    })
    
    return interfaces

def parse_process(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
    """
    Parse ps aux output and convert to standardized format
    Standard fields: pid, user, cpu, mem, command
    """
    lines = output.strip().split('\n')
    processes = []
    os_type = os_type.lower()
    
    if os_type in ['linux', 'sunos']:
        for line in lines[1:]:  # Skip header
            if line.strip():
                fields = line.split(None, 10)  # Split on whitespace, max 10 splits
                if len(fields) >= 11:
                    processes.append({
                        'timestamp': timestamp,
                        'pid': int(fields[1]),
                        'user': fields[0],
                        'cpu': float(fields[2]),
                        'mem': float(fields[3]),
                        'command': fields[10],
                    })
    
    return processes[:10]  # Return top 10 processes
    
    

# Example command outputs for reference:

"""
LINUX COMMAND OUTPUTS:
======================

1. vmstat 1 1:
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 1  0      0 1234567  12345 123456    0    0     1     2  100  200  5 10 85  0  0

2. iostat -d 1 1:
Linux 5.4.0 (hostname)     01/01/2024      _x86_64_        (4 CPU)

Device             tps    kB_read/s    kB_wrtn/s    kB_read    kB_wrtn
sda               1.50         12.34         5.67      123456      56789
sdb               0.25          1.23         0.45       12345       4567

3. netstat -i -n:
Kernel Interface table
Iface   MTU Met   RX-OK RX-ERR RX-DRP RX-OVR    TX-OK TX-ERR TX-DRP TX-OVR Flg
eth0   1500   0  123456      0      0 0        123456      0      0      0 BMRU
lo    65536   0    1234      0      0 0          1234      0      0      0 LRU

4. ps aux | sort -nrk 3 | head -10:
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.1  0.2  12345  1234 ?        Ss   Jan01   0:01 /sbin/init
daemon     123  0.0  0.1   5678   567 ?        S    Jan01   0:00 /usr/sbin/daemon

SOLARIS COMMAND OUTPUTS:
========================

1. vmstat 1 1:
kthr      memory            page            disk          faults      cpu
 r b w   swap  free  re  mf pi po fr de sr s0 s1 s2 s3   in   sy   cs us sy id
 1 0 0 1234567 123456  0   0  0  0  0  0  0  0  0  0  0  100  200  150  5 10 85

2. iostat -d 1 1:
                    extended device statistics
device    r/s    w/s   kr/s   kw/s wait actv  svc_t  %w  %b
c0d0      1.0    0.5   12.3    5.6  0.0  0.0    5.2   0   1
c1d0      0.2    0.1    1.2    0.4  0.0  0.0    3.1   0   0

3. netstat -i:
Name  Mtu  Net/Dest      Address        Ipkts  Ierrs Opkts  Oerrs Collis Queue
hme0  1500 192.168.1.0   192.168.1.100  123456     0 123456     0      0     0
lo0   8232 127.0.0.0     127.0.0.1        1234     0   1234     0      0     0

4. ps aux | sort -nrk 3 | head -10:
USER       PID %CPU %MEM   SZ  RSS TT       S    START  TIME COMMAND
root         1  0.1  0.2  123  456 ?        S      Jan01  0:01 /sbin/init
daemon     123  0.0  0.1   78   90 ?        S      Jan01  0:00 /usr/lib/daemon
"""
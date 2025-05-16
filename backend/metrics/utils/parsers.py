# Parsing functions
def parse_vmstat(output):
    lines = [line for line in output.split('\n') if line.strip()]
    if len(lines) < 2:
        raise ValueError("Not enough lines in vmstat output")
    data_line = lines[-1].split()
    if len(data_line) < 15:
        raise ValueError(f"Unexpected vmstat format. Got {len(data_line)} columns, expected 15")
    return {
        'r': int(data_line[0]), 
        'b': int(data_line[1]),
        'avm': int(data_line[4]), 
        'fre': int(data_line[5]),
        'pi': int(data_line[6]), 
        'po': int(data_line[7]), 
        'fr': int(data_line[8]), 
        'in': int(data_line[9]),
        'cs': int(data_line[10]), 
        'us': float(data_line[12])/1000,
        'sy': float(data_line[13]),
        'idle': float(data_line[14]) 
    }

def parse_iostat(output):
    metrics = []
    for line in output.split('\n'):
        if 'hdisk' in line and len(line.split()) >= 5:
            parts = line.split()
            metrics.append({
                'disk': parts[0],
                'tps': float(parts[1]),
                'kb_read': float(parts[2]),
                'kb_wrtn': float(parts[3]),
                'service_time': float(parts[4])
            })
    return metrics

def parse_netstat_i(output):
    metrics = []
    for line in output.split('\n'):
        if line.startswith(('en', 'lo', 'eth')) and not line.startswith('Name'):
            parts = line.split()
            if len(parts) >= 9:
                metrics.append({
                    'interface': parts[0],
                    'ipkts': int(parts[4]),
                    'ierrs': int(parts[5]),
                    'opkts': int(parts[6]),
                    'oerrs': int(parts[7]),
                    'coll': int(parts[8])
                })
    return metrics

def parse_topas(output):
    metrics = {}
    for line in output.split('\n'):
        line = line.strip()
        if 'User%' in line and 'Kern%' in line:
            parts = line.split()
            if len(parts) >= 6:
                try:
                    metrics.update({
                        'cpu_user': float(parts[1]),
                        'cpu_kern': float(parts[3]),
                        'cpu_idle': float(parts[5])
                    })
                except:
                    pass
        elif 'Real,MB' in line:
            parts = line.split()
            if len(parts) >= 10:
                try:
                    metrics.update({
                        'mem_real_free': int(parts[5]),
                        'mem_virtual_free': int(parts[9])
                    })
                except:
                    pass
        elif 'Disk Busy' in line and 'hdisk' in line:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    metrics['disk_busy'] = float(parts[1])
                except:
                    pass
        elif 'Network' in line and ('en' in line or 'eth' in line):
            parts = line.split()
            if len(parts) >= 4:
                try:
                    metrics['network_mbps'] = float(parts[3])
                except:
                    pass
    return metrics

def parse_process(output, sort_by="cpu"):
    processes = []
    for line in output.split('\n')[1:]:
        parts = line.split(None, 10)
        if len(parts) < 11:
            continue
        try:
            processes.append({
                'pid': int(parts[1]),
                'user': parts[0],
                'cpu': float(parts[2]),
                'mem': float(parts[3]),
                'command': parts[10]
            })
        except ValueError:
            continue
    return processes
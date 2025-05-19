import re

def parse_vmstat(output):
    """
    Parse AIX vmstat output in a more robust way by looking at headers.
    This handles potential variations in AIX vmstat output format.
    """
    lines = [line for line in output.split('\n') if line.strip()]
    
    # Find header line and data line
    header_line = None
    data_line = None
    
    for i, line in enumerate(lines):
        if 'r' in line and 'b' in line and 'avm' in line and 'fre' in line:
            header_line = line
            # Data line should be the next non-empty line after the header
            for j in range(i+1, len(lines)):
                if lines[j].strip() and not "----" in lines[j]:
                    data_line = lines[j]
                    break
            break
    
    if not header_line or not data_line:
        raise ValueError("Could not find header or data line in vmstat output")
    
    # Parse header to determine column positions
    header_parts = header_line.split()
    # Create a mapping of column names to their positions
    column_map = {name: idx for idx, name in enumerate(header_parts)}
    
    # Required columns
    required_columns = ['r', 'b', 'avm', 'fre', 'pi', 'po', 'fr', 'cs', 'us', 'sy', 'id']
    
    # Check if all required columns are present
    missing_columns = [col for col in required_columns if col not in column_map]
    if missing_columns:
        raise ValueError(f"Missing required columns in vmstat output: {missing_columns}")
    
    # Parse data
    data_parts = data_line.split()
    if len(data_parts) < len(header_parts):
        raise ValueError(f"Data line has fewer columns than header: {len(data_parts)} vs {len(header_parts)}")
    
    # Map the data to the correct fields
    result = {
        'r': int(data_parts[column_map['r']]),
        'b': int(data_parts[column_map['b']]),
        'avm': int(data_parts[column_map['avm']]),
        'fre': int(data_parts[column_map['fre']]),
        'pi': int(data_parts[column_map['pi']]),
        'po': int(data_parts[column_map['po']]),
        'fr': int(data_parts[column_map['fr']]),
        # 'in' is a reserved word in python, might be labeled differently
        'in': int(data_parts[column_map.get('in', column_map.get('inet', 0))]) if 'in' in column_map or 'inet' in column_map else 0,
        'cs': int(data_parts[column_map['cs']]),
        'us': float(data_parts[column_map['us']]),
        'sy': float(data_parts[column_map['sy']]),
        'idle': float(data_parts[column_map['id']])  # 'id' is typically the column name for idle in AIX
    }
    
    return result

def parse_iostat(output):
    """
    Parse AIX iostat output in a more robust way.
    Example AIX iostat output:
    
    System configuration: lcpu=4 mem=10240MB ent=0.10
    
    tty:      tin         tout
               0.2         40.0
    
    Disks:        % tm_act     Kbps      tps    Kb_read   Kb_wrtn
    hdisk0          0.0       0.0       0.0        0.0        0.0
    hdisk1          0.2      36.2       8.8      144.8        0.0
    """
    metrics = []
    disk_section = False
    headers = []
    
    lines = output.split('\n')
    
    # Find the disk section and headers
    for line in lines:
        if line.strip().startswith("Disks:"):
            disk_section = True
            headers = line.split()
            continue
        
        if not disk_section:
            continue
            
        # Skip headers line
        if any(header in line for header in ['tm_act', 'Kbps', 'tps']):
            continue
            
        # Look for disk lines (hdisk, cd, etc.)
        parts = line.strip().split()
        if len(parts) >= 5 and (parts[0].startswith(('hdisk', 'cd', 'vd', 'disk'))):
            try:
                metrics.append({
                    'disk': parts[0],
                    'tps': float(parts[2]),
                    'kb_read': float(parts[3]),
                    'kb_wrtn': float(parts[4]),
                    # For older AIX versions, service_time may not exist
                    'service_time': float(parts[5]) if len(parts) > 5 else 0.0
                })
            except (ValueError, IndexError) as e:
                print(f"Error parsing iostat line: {line}, {str(e)}")
                continue
                
    return metrics

def parse_netstat_i(output):
    """
    Parse AIX netstat -i -n output in a more robust way.
    Example AIX netstat -i -n output:
    
    Name  Mtu   Network     Address          Ipkts Ierrs    Opkts Oerrs  Coll
    en0   1500  link#2      aa.bb.cc.dd.ee.ff 12345     0   67890     0     0
    en0   1500  192.168.1   192.168.1.100    12345     0   67890     0     0
    lo0   16896 127         127.0.0.1        67890     0   67890     0     0
    """
    metrics = []
    header_found = False
    header_map = {}
    
    lines = output.split('\n')
    
    for line in lines:
        parts = line.strip().split()
        if not parts:
            continue
            
        # Find the header line
        if parts[0] == "Name" or "Name" in line:
            # Create mapping of column names to their position
            header_map = {name.lower(): idx for idx, name in enumerate(parts)}
            header_found = True
            continue
            
        if not header_found:
            continue
            
        # Process only interface lines that have an interface name
        # AIX interfaces typically start with en, et, lo
        interface_name = parts[0]
        if re.match(r'^(en|et|lo|tr|ib|ml)\d+', interface_name):
            # Skip duplicate interface entries (those with the same name but different network)
            # AIX netstat -i lists each interface multiple times for each network bound
            interface_exists = any(metric['interface'] == interface_name for metric in metrics)
            if interface_exists:
                continue
                
            try:
                # Extract data based on header positions
                # If header not found, fall back to assumed positions
                metric = {
                    'interface': interface_name,
                    'ipkts': int(parts[header_map.get('ipkts', 4)]),
                    'ierrs': int(parts[header_map.get('ierrs', 5)]),
                    'opkts': int(parts[header_map.get('opkts', 6)]),
                    'oerrs': int(parts[header_map.get('oerrs', 7)]),
                    'coll': int(parts[header_map.get('coll', 8)])
                }
                metrics.append(metric)
            except (ValueError, IndexError) as e:
                print(f"Error parsing netstat line: {line}, {str(e)}")
                continue
                
    return metrics

def parse_process(output, sort_by="cpu"):
    """
    Parse AIX process information (ps aux) in a more robust way.
    Example AIX ps aux output:
    
    USER       PID %CPU %MEM   VSZ  RSS  TTY STAT STARTED     TIME COMMAND
    root     12345  1.2  0.5 12345 1234  ?   S    May 19 00:01:23 /usr/sbin/process1
    user1    23456  0.8  0.3 23456 2345  ?   S    May 19 00:00:45 /usr/bin/process2
    """
    processes = []
    header_found = False
    header_map = {}
    
    lines = output.split('\n')
    
    for line in lines:
        parts = line.strip().split(None, 10)  # Split up to 11 parts (last is command)
        if not parts:
            continue
            
        # Look for header line
        if 'PID' in parts and ('%CPU' in parts or 'CPU' in parts):
            # Create mapping of column names to their position
            header_map = {}
            for idx, name in enumerate(parts):
                if name == '%CPU':
                    header_map['cpu'] = idx
                elif name == '%MEM':
                    header_map['mem'] = idx
                elif name == 'PID':
                    header_map['pid'] = idx
                elif name == 'USER':
                    header_map['user'] = idx
                elif name == 'COMMAND' or name == 'CMD':
                    header_map['command'] = idx
            header_found = True
            continue
            
        # If we don't have header info, use default positions for common ps formats
        if not header_found and len(parts) >= 11:
            header_map = {'user': 0, 'pid': 1, 'cpu': 2, 'mem': 3, 'command': 10}
            
        # Process ps line
        if len(parts) >= max(header_map.values()) + 1:
            try:
                process = {
                    'user': parts[header_map.get('user', 0)],
                    'pid': int(parts[header_map.get('pid', 1)]),
                    'cpu': float(parts[header_map.get('cpu', 2)].replace('%', '')),
                    'mem': float(parts[header_map.get('mem', 3)].replace('%', '')),
                    'command': parts[header_map.get('command', 10)]
                }
                processes.append(process)
            except (ValueError, IndexError) as e:
                print(f"Error parsing process line: {line}, {str(e)}")
                continue
                
    return processes
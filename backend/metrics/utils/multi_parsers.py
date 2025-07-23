# import re
# from datetime import datetime
# from typing import Dict, List, Any
# import platform
# import logging

# logger = logging.getLogger(__name__)

# def parse_vmstat(output: str, os_type: str, timestamp: datetime) -> Dict[str, Any]:
#     """
#     Parse vmstat output from different OS and convert to standardized format
#     Standard fields: r, b, avm, fre, pi, po, fr, interface_in, cs, us, sy, idle
#     """
#     lines = output.strip().split('\n')
#     os_type = os_type.lower()
#     logger.debug(f"Parsing vmstat for OS: {os_type}")
#     logger.debug(f"Raw vmstat output:\n{output}")
    
#     parsed_metrics = None
    
#     if os_type == 'linux':
#         logger.debug("Processing Linux vmstat format")
#         for line in lines:
#             if re.match(r'^\s*\d+\s+\d+', line):
#                 fields = line.split()
#                 logger.debug(f"Found data line with {len(fields)} fields: {fields}")
#                 if len(fields) >= 15:
#                     parsed_metrics = {
#                         'timestamp': timestamp.isoformat(),
#                         'r': int(fields[0]),
#                         'b': int(fields[1]),
#                         'avm': int(fields[2]),  # swpd (swap used)
#                         'fre': int(fields[3]),  # free memory
#                         'pi': int(fields[5]),   # si (swap in)
#                         'po': int(fields[6]),   # so (swap out)
#                         'fr': int(fields[7]),   # bi (blocks in)
#                         'interface_in': int(fields[10]),  # in (interrupts)
#                         'cs': int(fields[11]),  # cs (context switches)
#                         'us': float(fields[12]), 
#                         'sy': float(fields[13]),
#                         'idle': float(fields[14]),
#                     }
#                     logger.info(f"Successfully parsed Linux vmstat: {parsed_metrics}")
#                     break
#                 else:
#                     logger.warning(f"Linux vmstat line has insufficient fields: {len(fields)}")
    
#     elif os_type == 'sunos':  # Solaris
#         logger.debug("Processing Solaris vmstat format")
#         for line in lines:
#             if re.match(r'^\s*\d+\s+\d+\s+\d+', line):
#                 fields = line.split()
#                 logger.debug(f"Found data line with {len(fields)} fields: {fields}")
#                 if len(fields) >= 22:
#                     parsed_metrics = {
#                         'timestamp': timestamp,
#                         'r': int(fields[0]),
#                         'b': int(fields[1]),
#                         'avm': int(fields[3]),  # swap
#                         'fre': int(fields[4]),  # free
#                         'pi': int(fields[7]),   # pi (page in)
#                         'po': int(fields[8]),   # po (page out)
#                         'fr': int(fields[9]),   # fr (page freed)
#                         'interface_in': int(fields[16]), 
#                         'cs': int(fields[18]),
#                         'us': float(fields[19]),
#                         'sy': float(fields[20]),
#                         'idle': float(fields[21]),
#                     }
#                     logger.info(f"Successfully parsed Solaris vmstat: {parsed_metrics}")
#                     break
#                 else:
#                     logger.warning(f"Solaris vmstat line has insufficient fields: {len(fields)}")
    
#     else:  # AIX format (default)
#         logger.debug("Processing AIX vmstat format")
#         # Use the robust AIX parsing logic from parsers.py
#         header_line = None
#         data_line = None
        
#         for i, line in enumerate(lines):
#             if 'r' in line and 'b' in line and 'avm' in line and 'fre' in line:
#                 header_line = line
#                 logger.debug(f"Found header line: {header_line}")
#                 # Data line should be the next non-empty line after the header
#                 for j in range(i+1, len(lines)):
#                     if lines[j].strip() and not "----" in lines[j]:
#                         data_line = lines[j]
#                         logger.debug(f"Found data line: {data_line}")
#                         break
#                 break
        
#         if header_line and data_line:
#             # Parse header to determine column positions
#             header_parts = header_line.split()
#             column_map = {name: idx for idx, name in enumerate(header_parts)}
#             logger.debug(f"Column mapping: {column_map}")
            
#             # Parse data
#             data_parts = data_line.split()
#             logger.debug(f"Data parts: {data_parts}")
            
#             if len(data_parts) >= len(header_parts):
#                 parsed_metrics = {
#                     'timestamp': timestamp,
#                     'r': int(data_parts[column_map['r']]),
#                     'b': int(data_parts[column_map['b']]),
#                     'avm': int(data_parts[column_map['avm']]),
#                     'fre': int(data_parts[column_map['fre']]),
#                     'pi': int(data_parts[column_map['pi']]),
#                     'po': int(data_parts[column_map['po']]),
#                     'fr': int(data_parts[column_map['fr']]),
#                     'interface_in': int(data_parts[column_map.get('in', column_map.get('inet', 0))]) if 'in' in column_map or 'inet' in column_map else 0,
#                     'cs': int(data_parts[column_map['cs']]),
#                     'us': float(data_parts[column_map['us']]),
#                     'sy': float(data_parts[column_map['sy']]),
#                     'idle': float(data_parts[column_map.get('id', column_map.get('idle', 0))]),
#                 }
#                 logger.info(f"Successfully parsed AIX vmstat: {parsed_metrics}")
#             else:
#                 logger.error(f"AIX vmstat data line has fewer columns than header: {len(data_parts)} vs {len(header_parts)}")
#         else:
#             logger.error("Could not find header or data line in AIX vmstat output")
    
#     if parsed_metrics is None:
#         logger.error(f"Failed to parse vmstat output for OS: {os_type}")
#         return {}
    
#     logger.debug(f"Final parsed vmstat metrics: {parsed_metrics}")    
#     return parsed_metrics

# def parse_iostat(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
#     """
#     Parse iostat output and convert to standardized format
#     Standard fields: disk, tps, kb_read, kb_wrtn, service_time
#     """
#     lines = output.strip().split('\n')
#     devices = []
#     os_type = os_type.lower()
#     logger.debug(f"Parsing iostat for OS: {os_type}")
#     logger.debug(f"Raw iostat output:\n{output}")
    
#     if os_type == 'linux':
#         logger.debug("Processing Linux iostat format")
#         in_device_section = False
#         for line in lines:
#             if 'Device' in line and 'tps' in line:
#                 in_device_section = True
#                 logger.debug(f"Found device section header: {line}")
#                 continue
#             if in_device_section and line.strip():
#                 fields = line.split()
#                 logger.debug(f"Processing device line: {fields}")
#                 if len(fields) >= 6:
#                     device = {
#                         'timestamp': timestamp.isoformat(),
#                         'disk': fields[0],
#                         'tps': float(fields[1]),
#                         'kb_read': float(fields[4]),
#                         'kb_wrtn': float(fields[5]),
#                         'service_time': 0.0,
#                     }
#                     devices.append(device)
#                     logger.debug(f"Added Linux device: {device}")
#                 else:
#                     logger.warning(f"Linux iostat line has insufficient fields: {len(fields)}")
    
#     elif os_type == 'sunos':  # Solaris
#         logger.debug("Processing Solaris iostat format")
#         in_device_section = False
#         for line in lines:
#             if 'device' in line and 'r/s' in line:
#                 in_device_section = True
#                 logger.debug(f"Found device section header: {line}")
#                 continue
#             if in_device_section and line.strip():
#                 fields = line.split()
#                 logger.debug(f"Processing device line: {fields}")
#                 if len(fields) >= 8:
#                     device = {
#                         'timestamp': timestamp.isoformat(),
#                         'disk': fields[0],
#                         'tps': float(fields[1]) + float(fields[2]),
#                         'kb_read': float(fields[3]),
#                         'kb_wrtn': float(fields[4]),
#                         'service_time': float(fields[7]),
#                     }
#                     devices.append(device)
#                     logger.debug(f"Added Solaris device: {device}")
#                 else:
#                     logger.warning(f"Solaris iostat line has insufficient fields: {len(fields)}")
    
#     else:  # AIX format (default)
#         logger.debug("Processing AIX iostat format")
#         # Use the robust AIX parsing logic from parsers.py
#         disk_section = False
        
#         for line in lines:
#             if line.strip().startswith("Disks:"):
#                 disk_section = True
#                 logger.debug(f"Found disk section: {line}")
#                 continue
            
#             if not disk_section:
#                 continue
                
#             # Skip headers line
#             if any(header in line for header in ['tm_act', 'Kbps', 'tps']):
#                 logger.debug(f"Skipping header line: {line}")
#                 continue
                
#             # Look for disk lines (hdisk, cd, etc.)
#             parts = line.strip().split()
#             if len(parts) >= 5 and (parts[0].startswith(('hdisk', 'cd', 'vd', 'disk'))):
#                 try:
#                     device = {
#                         'timestamp': timestamp.isoformat(),
#                         'disk': parts[0],
#                         'tps': float(parts[2]),
#                         'kb_read': float(parts[3]),
#                         'kb_wrtn': float(parts[4]),
#                         'service_time': float(parts[5]) if len(parts) > 5 else 0.0
#                     }
#                     devices.append(device)
#                     logger.debug(f"Added AIX device: {device}")
#                 except (ValueError, IndexError) as e:
#                     logger.error(f"Error parsing AIX iostat line: {line}, {str(e)}")
#                     continue
    
#     logger.info(f"Successfully parsed {len(devices)} iostat devices for {os_type}")
#     return devices

# def parse_netstat(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
#     """
#     Parse netstat -i -n output and convert to standardized format
#     Standard fields: interface, ipkts, ierrs, opkts, oerrs, time (for AIX)
#     """
#     lines = output.strip().split('\n')
#     interfaces = []
#     os_type = os_type.lower()
#     logger.debug(f"Parsing netstat for OS: {os_type}")
#     logger.debug(f"Raw netstat output:\n{output}")
    
#     if os_type == 'linux':
#         logger.debug("Processing Linux netstat format")
#         header_found = False
#         for line in lines:
#             if 'Iface' in line and 'RX-OK' in line:
#                 header_found = True
#                 logger.debug(f"Found header: {line}")
#                 continue
#             if header_found and line.strip():
#                 fields = line.split()
#                 logger.debug(f"Processing interface line: {fields}")
#                 if len(fields) >= 11:
#                     interface = {
#                         'timestamp': timestamp,
#                         'interface': fields[0],
#                         'ipkts': int(fields[3]),      # RX-OK
#                         'ierrs': int(fields[4]),      # RX-ERR
#                         'opkts': int(fields[7]),      # TX-OK
#                         'oerrs': int(fields[8]),      # TX-ERR
#                     }
#                     interfaces.append(interface)
#                     logger.debug(f"Added Linux interface: {interface}")
#                 else:
#                     logger.warning(f"Linux netstat line has insufficient fields: {len(fields)}")
    
#     elif os_type == 'sunos':  # Solaris
#         logger.debug("Processing Solaris netstat format")
#         header_found = False
#         for line in lines:
#             if 'Name' in line and 'Ipkts' in line:
#                 header_found = True
#                 logger.debug(f"Found header: {line}")
#                 continue
#             if header_found and line.strip():
#                 fields = line.split()
#                 logger.debug(f"Processing interface line: {fields}")
#                 if len(fields) >= 8:
#                     interface = {
#                         'timestamp': timestamp,
#                         'interface': fields[0],
#                         'ipkts': int(fields[4]),      # Ipkts
#                         'ierrs': int(fields[5]),      # Ierrs
#                         'opkts': int(fields[6]),      # Opkts
#                         'oerrs': int(fields[7]),      # Oerrs
#                     }
#                     interfaces.append(interface)
#                     logger.debug(f"Added Solaris interface: {interface}")
#                 else:
#                     logger.warning(f"Solaris netstat line has insufficient fields: {len(fields)}")
    
#     else:  # AIX format (default)
#         logger.debug("Processing AIX netstat format")
#         # Use the robust AIX parsing logic from parsers.py
#         header_found = False
#         processed_interfaces = set()  # Track interfaces to avoid duplicates

#         for line in lines:
#             line = line.strip()
#             if not line:
#                 continue

#             parts = line.split()
#             if not parts:
#                 continue

#             # Detect header line
#             if parts[0] == "Name":
#                 header_found = True
#                 logger.debug(f"Found header: {line}")
#                 continue

#             if not header_found:
#                 continue

#             # Skip lines without valid interface names (e.g., en0, lo0)
#             interface_name = parts[0]
#             if not re.match(r'^(en|et|lo|tr|ib|ml)\d+', interface_name):
#                 logger.debug(f"Skipping invalid interface: {interface_name}")
#                 continue

#             # Skip duplicate interface entries (process only the first occurrence)
#             if interface_name in processed_interfaces:
#                 logger.debug(f"Skipping duplicate interface: {interface_name}")
#                 continue
#             processed_interfaces.add(interface_name)

#             # Extract the last 5 fields: Ipkts, Ierrs, Opkts, Oerrs, Time
#             try:
#                 if len(parts) >= 5:
#                     interface = {
#                         'timestamp': timestamp,
#                         'interface': interface_name,
#                         'ipkts': int(parts[-5]),
#                         'ierrs': int(parts[-4]),
#                         'opkts': int(parts[-3]),
#                         'oerrs': int(parts[-2]),
#                         'time': int(parts[-1]) if len(parts) >= 5 else 0  # Interface uptime in seconds
#                     }
#                     interfaces.append(interface)
#                     logger.debug(f"Added AIX interface: {interface}")
#                 else:
#                     logger.warning(f"AIX netstat line has insufficient fields: {len(parts)}")
#             except (IndexError, ValueError) as e:
#                 logger.error(f"Skipping line due to parsing error: {line} | Error: {e}")
#                 continue
    
#     logger.info(f"Successfully parsed {len(interfaces)} netstat interfaces for {os_type}")
#     return interfaces

# def parse_process(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
#     """
#     Parse ps aux output and convert to standardized format
#     Standard fields: pid, user, cpu, mem, command
#     """
#     lines = output.strip().split('\n')
#     processes = []
#     os_type = os_type.lower()
#     logger.debug(f"Parsing process list for OS: {os_type}")
#     logger.debug(f"Raw process output:\n{output}")
    
#     if os_type in ['linux', 'sunos']:
#         logger.debug(f"Processing {os_type} process format")
#         if len(lines) > 1:
#             header_line = lines[0]
#             logger.debug(f"Header line: {header_line}")
            
#             for line in lines[1:]:  # Skip header
#                 if line.strip():
#                     fields = line.split(None, 10)  # Split on whitespace, max 10 splits
#                     logger.debug(f"Processing process line: {fields}")
#                     if len(fields) >= 11:
#                         try:
#                             process = {
#                                 'timestamp': timestamp,
#                                 'pid': int(fields[1]),
#                                 'user': fields[0],
#                                 'cpu': float(fields[2]),
#                                 'mem': float(fields[3]),
#                                 'command': fields[10],
#                             }
#                             processes.append(process)
#                             logger.debug(f"Added process: {process}")
#                         except (ValueError, IndexError) as e:
#                             logger.error(f"Error parsing process line: {line}, {str(e)}")
#                             continue
#                     else:
#                         logger.warning(f"Process line has insufficient fields: {len(fields)}")
    
#     else:  # AIX format (default)
#         logger.debug("Processing AIX process format")
#         # Use the robust AIX parsing logic from parsers.py
#         header_found = False
#         header_map = {}
        
#         for line in lines:
#             parts = line.strip().split(None, 10)  # Split up to 11 parts (last is command)
#             if not parts:
#                 continue
                
#             # Look for header line
#             if 'PID' in parts and ('%CPU' in parts or 'CPU' in parts):
#                 # Create mapping of column names to their position
#                 header_map = {}
#                 for idx, name in enumerate(parts):
#                     if name == '%CPU':
#                         header_map['cpu'] = idx
#                     elif name == '%MEM':
#                         header_map['mem'] = idx
#                     elif name == 'PID':
#                         header_map['pid'] = idx
#                     elif name == 'USER':
#                         header_map['user'] = idx
#                     elif name == 'COMMAND' or name == 'CMD':
#                         header_map['command'] = idx
#                 header_found = True
#                 logger.debug(f"Found AIX header with mapping: {header_map}")
#                 continue
                
#             # If we don't have header info, use default positions for common ps formats
#             if not header_found and len(parts) >= 11:
#                 header_map = {'user': 0, 'pid': 1, 'cpu': 2, 'mem': 3, 'command': 10}
#                 logger.debug(f"Using default AIX header mapping: {header_map}")
                
#             # Process ps line
#             if len(parts) >= max(header_map.values()) + 1:
#                 try:
#                     process = {
#                         'timestamp': timestamp,
#                         'user': parts[header_map.get('user', 0)],
#                         'pid': int(parts[header_map.get('pid', 1)]),
#                         'cpu': float(parts[header_map.get('cpu', 2)].replace('%', '')),
#                         'mem': float(parts[header_map.get('mem', 3)].replace('%', '')),
#                         'command': parts[header_map.get('command', 10)]
#                     }
#                     processes.append(process)
#                     logger.debug(f"Added AIX process: {process}")
#                 except (ValueError, IndexError) as e:
#                     logger.error(f"Error parsing AIX process line: {line}, {str(e)}")
#                     continue
    
#     # Return top 10 processes
#     result = processes[:10]
#     logger.info(f"Successfully parsed {len(result)} processes for {os_type}")
#     return result

import re
from datetime import datetime
from typing import Dict, List, Any
import platform
import logging

logger = logging.getLogger(__name__)

def parse_vmstat(output: str, os_type: str, timestamp: datetime) -> Dict[str, Any]:
    """
    Parse vmstat output from different OS and convert to standardized format
    Standard fields: r, b, avm, fre, pi, po, fr, interface_in, cs, us, sy, idle
    """
    lines = output.strip().split('\n')
    os_type = os_type.lower()
    logger.debug(f"Parsing vmstat for OS: {os_type}")
    logger.debug(f"Raw vmstat output:\n{output}")
    
    parsed_metrics = None
    # Convert timestamp to ISO string to ensure JSON serialization
    timestamp_str = timestamp.isoformat()
    
    if os_type == 'linux':
        logger.debug("Processing Linux vmstat format")
        for line in lines:
            if re.match(r'^\s*\d+\s+\d+', line):
                fields = line.split()
                logger.debug(f"Found data line with {len(fields)} fields: {fields}")
                if len(fields) >= 15:
                    parsed_metrics = {
                        'timestamp': timestamp_str,
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
                    logger.info(f"Successfully parsed Linux vmstat: {parsed_metrics}")
                    break
                else:
                    logger.warning(f"Linux vmstat line has insufficient fields: {len(fields)}")
    
    elif os_type == 'sunos':  # Solaris
        logger.debug("Processing Solaris vmstat format")
        for line in lines:
            if re.match(r'^\s*\d+\s+\d+\s+\d+', line):
                fields = line.split()
                logger.debug(f"Found data line with {len(fields)} fields: {fields}")
                if len(fields) >= 22:
                    parsed_metrics = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
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
                    logger.info(f"Successfully parsed Solaris vmstat: {parsed_metrics}")
                    break
                else:
                    logger.warning(f"Solaris vmstat line has insufficient fields: {len(fields)}")
    
    else:  # AIX format (default)
        logger.debug("Processing AIX vmstat format")
        # Use the robust AIX parsing logic from parsers.py
        header_line = None
        data_line = None
        
        for i, line in enumerate(lines):
            if 'r' in line and 'b' in line and 'avm' in line and 'fre' in line:
                header_line = line
                logger.debug(f"Found header line: {header_line}")
                # Data line should be the next non-empty line after the header
                for j in range(i+1, len(lines)):
                    if lines[j].strip() and not "----" in lines[j]:
                        data_line = lines[j]
                        logger.debug(f"Found data line: {data_line}")
                        break
                break
        
        if header_line and data_line:
            # Parse header to determine column positions
            header_parts = header_line.split()
            column_map = {name: idx for idx, name in enumerate(header_parts)}
            logger.debug(f"Column mapping: {column_map}")
            
            # Parse data
            data_parts = data_line.split()
            logger.debug(f"Data parts: {data_parts}")
            
            if len(data_parts) >= len(header_parts):
                parsed_metrics = {
                    'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                    'r': int(data_parts[column_map['r']]),
                    'b': int(data_parts[column_map['b']]),
                    'avm': int(data_parts[column_map['avm']]),
                    'fre': int(data_parts[column_map['fre']]),
                    'pi': int(data_parts[column_map['pi']]),
                    'po': int(data_parts[column_map['po']]),
                    'fr': int(data_parts[column_map['fr']]),
                    'interface_in': int(data_parts[column_map.get('in', column_map.get('inet', 0))]) if 'in' in column_map or 'inet' in column_map else 0,
                    'cs': int(data_parts[column_map['cs']]),
                    'us': float(data_parts[column_map['us']]),
                    'sy': float(data_parts[column_map['sy']]),
                    'idle': float(data_parts[column_map.get('id', column_map.get('idle', 0))]),
                }
                logger.info(f"Successfully parsed AIX vmstat: {parsed_metrics}")
            else:
                logger.error(f"AIX vmstat data line has fewer columns than header: {len(data_parts)} vs {len(header_parts)}")
        else:
            logger.error("Could not find header or data line in AIX vmstat output")
    
    if parsed_metrics is None:
        logger.error(f"Failed to parse vmstat output for OS: {os_type}")
        return {}
    
    logger.debug(f"Final parsed vmstat metrics: {parsed_metrics}")    
    return parsed_metrics

def parse_iostat(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
    """
    Parse iostat output and convert to standardized format
    Standard fields: disk, tps, kb_read, kb_wrtn, service_time
    """
    lines = output.strip().split('\n')
    devices = []
    os_type = os_type.lower()
    logger.debug(f"Parsing iostat for OS: {os_type}")
    logger.debug(f"Raw iostat output:\n{output}")
    
    # Convert timestamp to ISO string to ensure JSON serialization
    timestamp_str = timestamp.isoformat()
    
    if os_type == 'linux':
        logger.debug("Processing Linux iostat format")
        in_device_section = False
        for line in lines:
            if 'Device' in line and 'tps' in line:
                in_device_section = True
                logger.debug(f"Found device section header: {line}")
                continue
            if in_device_section and line.strip():
                fields = line.split()
                logger.debug(f"Processing device line: {fields}")
                if len(fields) >= 6:
                    device = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'disk': fields[0],
                        'tps': float(fields[1]),
                        'kb_read': float(fields[4]),
                        'kb_wrtn': float(fields[5]),
                        'service_time': 0.0,
                    }
                    devices.append(device)
                    logger.debug(f"Added Linux device: {device}")
                else:
                    logger.warning(f"Linux iostat line has insufficient fields: {len(fields)}")
    
    elif os_type == 'sunos':  # Solaris
        logger.debug("Processing Solaris iostat format")
        in_device_section = False
        for line in lines:
            if 'device' in line and 'r/s' in line:
                in_device_section = True
                logger.debug(f"Found device section header: {line}")
                continue
            if in_device_section and line.strip():
                fields = line.split()
                logger.debug(f"Processing device line: {fields}")
                if len(fields) >= 8:
                    device = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'disk': fields[0],
                        'tps': float(fields[1]) + float(fields[2]),
                        'kb_read': float(fields[3]),
                        'kb_wrtn': float(fields[4]),
                        'service_time': float(fields[7]),
                    }
                    devices.append(device)
                    logger.debug(f"Added Solaris device: {device}")
                else:
                    logger.warning(f"Solaris iostat line has insufficient fields: {len(fields)}")
    
    else:  # AIX format (default)
        logger.debug("Processing AIX iostat format")
        # Use the robust AIX parsing logic from parsers.py
        disk_section = False
        
        for line in lines:
            if line.strip().startswith("Disks:"):
                disk_section = True
                logger.debug(f"Found disk section: {line}")
                continue
            
            if not disk_section:
                continue
                
            # Skip headers line
            if any(header in line for header in ['tm_act', 'Kbps', 'tps']):
                logger.debug(f"Skipping header line: {line}")
                continue
                
            # Look for disk lines (hdisk, cd, etc.)
            parts = line.strip().split()
            if len(parts) >= 5 and (parts[0].startswith(('hdisk', 'cd', 'vd', 'disk'))):
                try:
                    device = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'disk': parts[0],
                        'tps': float(parts[2]),
                        'kb_read': float(parts[3]),
                        'kb_wrtn': float(parts[4]),
                        'service_time': float(parts[5]) if len(parts) > 5 else 0.0
                    }
                    devices.append(device)
                    logger.debug(f"Added AIX device: {device}")
                except (ValueError, IndexError) as e:
                    logger.error(f"Error parsing AIX iostat line: {line}, {str(e)}")
                    continue
    
    logger.info(f"Successfully parsed {len(devices)} iostat devices for {os_type}")
    return devices

def parse_netstat(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
    """
    Parse netstat -i -n output and convert to standardized format
    Standard fields: interface, ipkts, ierrs, opkts, oerrs, time (for AIX)
    """
    lines = output.strip().split('\n')
    interfaces = []
    os_type = os_type.lower()
    logger.debug(f"Parsing netstat for OS: {os_type}")
    logger.debug(f"Raw netstat output:\n{output}")
    
    # Convert timestamp to ISO string to ensure JSON serialization
    timestamp_str = timestamp.isoformat()
    
    if os_type == 'linux':
        logger.debug("Processing Linux netstat format")
        header_found = False
        for line in lines:
            if 'Iface' in line and 'RX-OK' in line:
                header_found = True
                logger.debug(f"Found header: {line}")
                continue
            if header_found and line.strip():
                fields = line.split()
                logger.debug(f"Processing interface line: {fields}")
                if len(fields) >= 11:
                    interface = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'interface': fields[0],
                        'ipkts': int(fields[3]),      # RX-OK
                        'ierrs': int(fields[4]),      # RX-ERR
                        'opkts': int(fields[7]),      # TX-OK
                        'oerrs': int(fields[8]),      # TX-ERR
                    }
                    interfaces.append(interface)
                    logger.debug(f"Added Linux interface: {interface}")
                else:
                    logger.warning(f"Linux netstat line has insufficient fields: {len(fields)}")
    
    elif os_type == 'sunos':  # Solaris
        logger.debug("Processing Solaris netstat format")
        header_found = False
        for line in lines:
            if 'Name' in line and 'Ipkts' in line:
                header_found = True
                logger.debug(f"Found header: {line}")
                continue
            if header_found and line.strip():
                fields = line.split()
                logger.debug(f"Processing interface line: {fields}")
                if len(fields) >= 8:
                    interface = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'interface': fields[0],
                        'ipkts': int(fields[4]),      # Ipkts
                        'ierrs': int(fields[5]),      # Ierrs
                        'opkts': int(fields[6]),      # Opkts
                        'oerrs': int(fields[7]),      # Oerrs
                    }
                    interfaces.append(interface)
                    logger.debug(f"Added Solaris interface: {interface}")
                else:
                    logger.warning(f"Solaris netstat line has insufficient fields: {len(fields)}")
    
    else:  # AIX format (default)
        logger.debug("Processing AIX netstat format")
        # Use the robust AIX parsing logic from parsers.py
        header_found = False
        processed_interfaces = set()  # Track interfaces to avoid duplicates

        for line in lines:
            line = line.strip()
            if not line:
                continue

            parts = line.split()
            if not parts:
                continue

            # Detect header line
            if parts[0] == "Name":
                header_found = True
                logger.debug(f"Found header: {line}")
                continue

            if not header_found:
                continue

            # Skip lines without valid interface names (e.g., en0, lo0)
            interface_name = parts[0]
            if not re.match(r'^(en|et|lo|tr|ib|ml)\d+', interface_name):
                logger.debug(f"Skipping invalid interface: {interface_name}")
                continue

            # Skip duplicate interface entries (process only the first occurrence)
            if interface_name in processed_interfaces:
                logger.debug(f"Skipping duplicate interface: {interface_name}")
                continue
            processed_interfaces.add(interface_name)

            # Extract the last 5 fields: Ipkts, Ierrs, Opkts, Oerrs, Time
            try:
                if len(parts) >= 5:
                    interface = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'interface': interface_name,
                        'ipkts': int(parts[-5]),
                        'ierrs': int(parts[-4]),
                        'opkts': int(parts[-3]),
                        'oerrs': int(parts[-2]),
                        'time': int(parts[-1]) if len(parts) >= 5 else 0  # Interface uptime in seconds
                    }
                    interfaces.append(interface)
                    logger.debug(f"Added AIX interface: {interface}")
                else:
                    logger.warning(f"AIX netstat line has insufficient fields: {len(parts)}")
            except (IndexError, ValueError) as e:
                logger.error(f"Skipping line due to parsing error: {line} | Error: {e}")
                continue
    
    logger.info(f"Successfully parsed {len(interfaces)} netstat interfaces for {os_type}")
    return interfaces

def parse_process(output: str, os_type: str, timestamp: datetime) -> List[Dict[str, Any]]:
    """
    Parse ps aux output and convert to standardized format
    Standard fields: pid, user, cpu, mem, command
    """
    lines = output.strip().split('\n')
    processes = []
    os_type = os_type.lower()
    logger.debug(f"Parsing process list for OS: {os_type}")
    logger.debug(f"Raw process output:\n{output}")
    
    # Convert timestamp to ISO string to ensure JSON serialization
    timestamp_str = timestamp.isoformat()
    
    if os_type in ['linux', 'sunos']:
        logger.debug(f"Processing {os_type} process format")
        if len(lines) > 1:
            header_line = lines[0]
            logger.debug(f"Header line: {header_line}")
            
            for line in lines[1:]:  # Skip header
                if line.strip():
                    fields = line.split(None, 10)  # Split on whitespace, max 10 splits
                    logger.debug(f"Processing process line: {fields}")
                    if len(fields) >= 11:
                        try:
                            process = {
                                'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                                'pid': int(fields[1]),
                                'user': fields[0],
                                'cpu': float(fields[2]),
                                'mem': float(fields[3]),
                                'command': fields[10],
                            }
                            processes.append(process)
                            logger.debug(f"Added process: {process}")
                        except (ValueError, IndexError) as e:
                            logger.error(f"Error parsing process line: {line}, {str(e)}")
                            continue
                    else:
                        logger.warning(f"Process line has insufficient fields: {len(fields)}")
    
    else:  # AIX format (default)
        logger.debug("Processing AIX process format")
        # Use the robust AIX parsing logic from parsers.py
        header_found = False
        header_map = {}
        
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
                logger.debug(f"Found AIX header with mapping: {header_map}")
                continue
                
            # If we don't have header info, use default positions for common ps formats
            if not header_found and len(parts) >= 11:
                header_map = {'user': 0, 'pid': 1, 'cpu': 2, 'mem': 3, 'command': 10}
                logger.debug(f"Using default AIX header mapping: {header_map}")
                
            # Process ps line
            if len(parts) >= max(header_map.values()) + 1:
                try:
                    process = {
                        'timestamp': timestamp_str,  # ✅ Fixed: Use ISO string
                        'user': parts[header_map.get('user', 0)],
                        'pid': int(parts[header_map.get('pid', 1)]),
                        'cpu': float(parts[header_map.get('cpu', 2)].replace('%', '')),
                        'mem': float(parts[header_map.get('mem', 3)].replace('%', '')),
                        'command': parts[header_map.get('command', 10)]
                    }
                    processes.append(process)
                    logger.debug(f"Added AIX process: {process}")
                except (ValueError, IndexError) as e:
                    logger.error(f"Error parsing AIX process line: {line}, {str(e)}")
                    continue
    
    # Return top 10 processes
    result = processes[:10]
    logger.info(f"Successfully parsed {len(result)} processes for {os_type}")
    return result


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

AIX COMMAND OUTPUTS:
====================

1. vmstat 1 1:
System configuration: lcpu=4 mem=2048MB ent=0.10

kthr     memory             page              faults        cpu
----- ----------- ------------------------ ------------ -----------
 r  b   avm   fre  re  pi  po  fr   sr  cy  in   sy  cs us sy id wa
 1  0 12345  1234   0   0   0   0    0   0 100  200 150  5 10 85  0

2. iostat:
System configuration: lcpu=4 mem=10240MB ent=0.10

tty:      tin         tout
           0.2         40.0

Disks:        % tm_act     Kbps      tps    Kb_read   Kb_wrtn
hdisk0          0.0       0.0       0.0        0.0        0.0
hdisk1          0.2      36.2       8.8      144.8        0.0

3. netstat -i -n:
Name   Mtu   Network     Address                 Ipkts     Ierrs        Opkts     Oerrs  Time
en0    1500  link#2      ae.22.e5.69.2d.3        481605681     0        724843214     0     12345
lo0    16896 link#1                              12345         0        12345         0     67890

4. ps aux | sort -nrk 3 | head -10:
USER       PID %CPU %MEM   VSZ  RSS  TTY STAT STARTED     TIME COMMAND
root     12345  1.2  0.5 12345 1234  ?   S    May 19 00:01:23 /usr/sbin/process1
user1    23456  0.8  0.3 23456 2345  ?   S    May 19 00:00:45 /usr/bin/process2
"""
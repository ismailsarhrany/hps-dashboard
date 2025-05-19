import json
import sqlite3

def export_table(table_name):
    conn = sqlite3.connect('system_metrics.db')
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table_name}")
    data = cursor.fetchall()
    with open(f'{table_name}.json', 'w') as f:
        json.dump(data, f)
    conn.close()

export_table('vmstat_metrics')
export_table('iostat_metrics')
export_table('netstat_metrics')
export_table('process_metrics')

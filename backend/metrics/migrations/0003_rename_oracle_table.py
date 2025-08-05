from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        # Keep the dependency from previous migration
        ('metrics', '0002_alter_oracledatabase_sid'),
    ]

    operations = [
        migrations.AlterModelTable(
            name='oracledatabase',
            table='oracle_databases',
        ),
    ]
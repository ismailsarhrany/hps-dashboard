from django.contrib import admin
from django.utils.html import format_html
from django.urls import reverse
from django.utils.safestring import mark_safe
import json
from .models import (
    AnomalyModel, AnomalyDetection, AnomalyPrediction, 
    CorrelationAnalysis, TrainingJob, AnomalyReport, 
    ModelPerformanceMetric
)


@admin.register(AnomalyModel)
class AnomalyModelAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'model_type', 'version', 'status', 'threshold', 
        'training_data_size', 'trained_at', 'performance_summary'
    ]
    list_filter = ['model_type', 'status', 'trained_at']
    search_fields = ['name', 'model_type']
    readonly_fields = ['id', 'created_at', 'updated_at', 'last_used']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('name', 'model_type', 'version', 'status', 'threshold')
        }),
        ('Model Files', {
            'fields': ('model_path', 'preprocessor_path', 'scaler_path')
        }),
        ('Training Information', {
            'fields': (
                'training_data_size', 'training_duration', 'features_used', 
                'config', 'performance_metrics'
            )
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at', 'trained_at', 'last_used'),
            'classes': ('collapse',)
        })
    )
    
    def performance_summary(self, obj):
        """Display a summary of model performance"""
        if obj.performance_metrics:
            metrics = obj.performance_metrics
            f1 = metrics.get('ensemble', {}).get('f1_score', 0)
            auc = metrics.get('ensemble', {}).get('auc_roc', 0)
            return format_html(
                '<span style="color: {};">F1: {:.3f} | AUC: {:.3f}</span>',
                'green' if f1 > 0.8 else 'orange' if f1 > 0.6 else 'red',
                f1, auc
            )
        return "No metrics available"
    performance_summary.short_description = "Performance"


@admin.register(AnomalyDetection)
class AnomalyDetectionAdmin(admin.ModelAdmin):
    list_display = [
        'server', 'timestamp', 'severity', 'anomaly_score', 
        'confidence', 'status', 'model'
    ]
    list_filter = [
        'severity', 'status', 'model__model_type', 
        'timestamp', 'created_at'
    ]
    search_fields = ['server__hostname', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('server', 'model', 'timestamp', 'status')
        }),
        ('Anomaly Details', {
            'fields': (
                'severity', 'anomaly_score', 'confidence', 
                'description', 'tags'
            )
        }),
        ('Metric Data', {
            'fields': (
                'metric_values', 'expected_values', 'deviation_percentages',
                'features_contributing'
            )
        }),
        ('Model Results', {
            'fields': ('individual_scores', 'model_agreement')
        }),
        ('Timestamps', {
            'fields': (
                'created_at', 'updated_at', 
                'acknowledged_at', 'resolved_at'
            ),
            'classes': ('collapse',)
        })
    )
    
    actions = ['mark_as_acknowledged', 'mark_as_resolved', 'mark_as_false_positive']
    
    def mark_as_acknowledged(self, request, queryset):
        queryset.update(status='acknowledged', acknowledged_at=timezone.now())
    mark_as_acknowledged.short_description = "Mark selected anomalies as acknowledged"
    
    def mark_as_resolved(self, request, queryset):
        queryset.update(status='resolved', resolved_at=timezone.now())
    mark_as_resolved.short_description = "Mark selected anomalies as resolved"
    
    def mark_as_false_positive(self, request, queryset):
        queryset.update(status='false_positive')
    mark_as_false_positive.short_description = "Mark selected anomalies as false positive"


@admin.register(AnomalyPrediction)
class AnomalyPredictionAdmin(admin.ModelAdmin):
    list_display = [
        'server', 'predicted_timestamp', 'prediction_type', 
        'probability', 'is_validated', 'actual_occurred'
    ]
    list_filter = [
        'prediction_type', 'is_validated', 'actual_occurred', 
        'trend_direction', 'seasonality_detected'
    ]
    search_fields = ['server__hostname']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'server', 'model', 'prediction_type', 
                'predicted_timestamp', 'probability'
            )
        }),
        ('Prediction Details', {
            'fields': (
                'predicted_metrics', 'risk_factors', 'recommendations',
                'confidence_interval'
            )
        }),
        ('Time Series Analysis', {
            'fields': (
                'forecast_data', 'seasonality_detected', 
                'trend_direction'
            )
        }),
        ('Validation', {
            'fields': (
                'is_validated', 'actual_occurred', 'validation_date'
            )
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        })
    )


@admin.register(CorrelationAnalysis)
class CorrelationAnalysisAdmin(admin.ModelAdmin):
    list_display = [
        'server', 'analysis_period_start', 'analysis_period_end',
        'total_anomalies_analyzed', 'analysis_confidence'
    ]
    list_filter = ['analysis_confidence', 'created_at']
    search_fields = ['server__hostname', 'summary_report']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Analysis Parameters', {
            'fields': (
                'server', 'analysis_period_start', 'analysis_period_end',
                'metric_types_analyzed'
            )
        }),
        ('Correlation Results', {
            'fields': (
                'correlation_matrix', 'strong_correlations',
                'anomaly_correlations'
            )
        }),
        ('Key Findings', {
            'fields': (
                'top_anomaly_indicators', 'seasonal_patterns',
                'anomaly_clusters'
            )
        }),
        ('Statistical Measures', {
            'fields': (
                'total_anomalies_analyzed', 'analysis_confidence',
                'statistical_significance'
            )
        }),
        ('Report', {
            'fields': ('summary_report', 'recommendations')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        })
    )


@admin.register(TrainingJob)
class TrainingJobAdmin(admin.ModelAdmin):
    list_display = [
        'model', 'status', 'progress', 'duration',
        'created_at', 'completed_at'
    ]
    list_filter = ['status', 'created_at', 'completed_at']
    search_fields = ['model__name']
    readonly_fields = [
        'id', 'created_at', 'started_at', 'completed_at', 'duration'
    ]
    
    fieldsets = (
        ('Job Information', {
            'fields': ('model', 'servers', 'status', 'progress')
        }),
        ('Configuration', {
            'fields': (
                'training_config', 'data_range_start', 'data_range_end'
            )
        }),
        ('Results', {
            'fields': (
                'training_logs', 'error_message', 'final_metrics'
            )
        }),
        ('Resource Usage', {
            'fields': ('cpu_usage', 'memory_usage', 'gpu_usage')
        }),
        ('Timestamps', {
            'fields': (
                'created_at', 'started_at', 'completed_at', 'duration'
            ),
            'classes': ('collapse',)
        })
    )
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('model')


@admin.register(AnomalyReport)
class AnomalyReportAdmin(admin.ModelAdmin):
    list_display = [
        'server', 'report_type', 'report_period_start',
        'total_anomalies', 'critical_anomalies', 'predictions_accuracy'
    ]
    list_filter = ['report_type', 'created_at']
    search_fields = ['server__hostname', 'executive_summary']
    readonly_fields = ['id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Report Configuration', {
            'fields': (
                'server', 'report_type', 'report_period_start',
                'report_period_end', 'generated_by'
            )
        }),
        ('Executive Summary', {
            'fields': ('executive_summary',)
        }),
        ('Anomaly Statistics', {
            'fields': (
                'total_anomalies', 'critical_anomalies', 'high_anomalies',
                'medium_anomalies', 'low_anomalies'
            )
        }),
        ('Prediction Statistics', {
            'fields': (
                'predictions_made', 'predictions_accuracy',
                'false_positive_rate'
            )
        }),
        ('Key Insights', {
            'fields': (
                'top_risk_metrics', 'trend_analysis', 'pattern_insights'
            )
        }),
        ('Recommendations', {
            'fields': (
                'immediate_actions', 'preventive_measures',
                'monitoring_adjustments'
            )
        }),
        ('Report Data', {
            'fields': ('report_data',),
            'classes': ('collapse',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        })
    )


@admin.register(ModelPerformanceMetric)
class ModelPerformanceMetricAdmin(admin.ModelAdmin):
    list_display = [
        'model', 'f1_score', 'precision', 'recall',
        'auc_roc', 'false_positive_rate', 'evaluated_at'
    ]
    list_filter = ['model', 'evaluated_at']
    readonly_fields = ['evaluated_at']
    
    fieldsets = (
        ('Model Information', {
            'fields': ('model', 'evaluated_at')
        }),
        ('Performance Metrics', {
            'fields': (
                'accuracy', 'precision', 'recall', 'f1_score', 'auc_roc'
            )
        }),
        ('Error Rates', {
            'fields': (
                'false_positive_rate', 'false_negative_rate',
                'detection_latency'
            )
        }),
        ('Test Data', {
            'fields': (
                'test_data_size', 'evaluation_period_start',
                'evaluation_period_end'
            )
        })
    )
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('model')


# Custom admin actions and utilities
from django.utils import timezone

def export_anomalies_csv(modeladmin, request, queryset):
    """Export selected anomalies to CSV"""
    import csv
    from django.http import HttpResponse
    
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="anomalies.csv"'
    
    writer = csv.writer(response)
    writer.writerow([
        'Server', 'Timestamp', 'Severity', 'Anomaly Score', 
        'Confidence', 'Status', 'Description'
    ])
    
    for obj in queryset:
        writer.writerow([
            obj.server.hostname,
            obj.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            obj.severity,
            obj.anomaly_score,
            obj.confidence,
            obj.status,
            obj.description
        ])
    
    return response

export_anomalies_csv.short_description = "Export selected anomalies to CSV"

# Add the action to AnomalyDetectionAdmin
AnomalyDetectionAdmin.actions.append(export_anomalies_csv)
from rest_framework import serializers
from django.utils import timezone
from datetime import datetime, timedelta
from .models import (
    AnomalyModel, AnomalyDetection, AnomalyPrediction,
    CorrelationAnalysis, TrainingJob, AnomalyReport,
    ModelPerformanceMetric
)


class AnomalyModelSerializer(serializers.ModelSerializer):
    """Serializer for AnomalyModel"""
    
    performance_summary = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    
    class Meta:
        model = AnomalyModel
        fields = [
            'id', 'name', 'model_type', 'version', 'status',
            'config', 'performance_metrics', 'threshold',
            'training_data_size', 'training_duration', 'features_used',
            'created_at', 'updated_at', 'trained_at', 'last_used',
            'performance_summary', 'is_active'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'trained_at', 
            'last_used', 'performance_summary', 'is_active'
        ]
    
    def get_performance_summary(self, obj):
        """Get a summary of model performance"""
        if obj.performance_metrics:
            ensemble_metrics = obj.performance_metrics.get('ensemble', {})
            return {
                'f1_score': ensemble_metrics.get('f1_score', 0),
                'accuracy': ensemble_metrics.get('accuracy', 0),
                'precision': ensemble_metrics.get('precision', 0),
                'recall': ensemble_metrics.get('recall', 0),
                'auc_roc': ensemble_metrics.get('auc_roc', 0)
            }
        return None
    
    def get_is_active(self, obj):
        """Check if model is actively being used"""
        return obj.status == 'ready' and obj.last_used and \
               timezone.now() - obj.last_used < timedelta(days=7)


class AnomalyDetectionSerializer(serializers.ModelSerializer):
    """Serializer for AnomalyDetection"""
    
    server_name = serializers.CharField(source='server.hostname', read_only=True)
    model_name = serializers.CharField(source='model.name', read_only=True)
    model_type = serializers.CharField(source='model.model_type', read_only=True)
    time_since_detection = serializers.SerializerMethodField()
    
    class Meta:
        model = AnomalyDetection
        fields = [
            'id', 'server', 'server_name', 'model', 'model_name', 'model_type',
            'timestamp', 'anomaly_score', 'confidence', 'severity', 'status',
            'metric_values', 'features_contributing', 'expected_values',
            'deviation_percentages', 'description', 'tags',
            'individual_scores', 'model_agreement',
            'created_at', 'updated_at', 'acknowledged_at', 'resolved_at',
            'time_since_detection'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'server_name',
            'model_name', 'model_type', 'time_since_detection'
        ]
    
    def get_time_since_detection(self, obj):
        """Get time since anomaly was detected"""
        delta = timezone.now() - obj.timestamp
        if delta.days > 0:
            return f"{delta.days} days ago"
        elif delta.seconds > 3600:
            hours = delta.seconds // 3600
            return f"{hours} hours ago"
        elif delta.seconds > 60:
            minutes = delta.seconds // 60
            return f"{minutes} minutes ago"
        else:
            return "Just now"


class AnomalyDetectionCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating AnomalyDetection instances"""
    
    class Meta:
        model = AnomalyDetection
        fields = [
            'server', 'model', 'timestamp', 'anomaly_score',
            'confidence', 'severity', 'metric_values',
            'features_contributing', 'expected_values',
            'deviation_percentages', 'description', 'tags',
            'individual_scores', 'model_agreement'
        ]


class AnomalyPredictionSerializer(serializers.ModelSerializer):
    """Serializer for AnomalyPrediction"""
    
    server_name = serializers.CharField(source='server.hostname', read_only=True)
    model_name = serializers.CharField(source='model.name', read_only=True)
    time_until_prediction = serializers.SerializerMethodField()
    risk_level = serializers.SerializerMethodField()
    
    class Meta:
        model = AnomalyPrediction
        fields = [
            'id', 'server', 'server_name', 'model', 'model_name',
            'prediction_type', 'predicted_timestamp', 'probability',
            'confidence_interval', 'predicted_metrics', 'risk_factors',
            'recommendations', 'forecast_data', 'seasonality_detected',
            'trend_direction', 'is_validated', 'actual_occurred',
            'validation_date', 'created_at', 'updated_at',
            'time_until_prediction', 'risk_level'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'server_name',
            'model_name', 'time_until_prediction', 'risk_level'
        ]
    
    def get_time_until_prediction(self, obj):
        """Get time until predicted anomaly"""
        delta = obj.predicted_timestamp - timezone.now()
        if delta.days > 0:
            return f"in {delta.days} days"
        elif delta.seconds > 3600:
            hours = delta.seconds // 3600
            return f"in {hours} hours"
        elif delta.seconds > 60:
            minutes = delta.seconds // 60
            return f"in {minutes} minutes"
        else:
            return "imminent"
    
    def get_risk_level(self, obj):
        """Determine risk level based on probability and time"""
        if obj.probability >= 0.8:
            return "high"
        elif obj.probability >= 0.6:
            return "medium"
        else:
            return "low"


class CorrelationAnalysisSerializer(serializers.ModelSerializer):
    """Serializer for CorrelationAnalysis"""
    
    server_name = serializers.CharField(source='server.hostname', read_only=True)
    analysis_duration = serializers.SerializerMethodField()
    
    class Meta:
        model = CorrelationAnalysis
        fields = [
            'id', 'server', 'server_name', 'analysis_period_start',
            'analysis_period_end', 'metric_types_analyzed',
            'correlation_matrix', 'strong_correlations',
            'anomaly_correlations', 'top_anomaly_indicators',
            'seasonal_patterns', 'anomaly_clusters',
            'total_anomalies_analyzed', 'analysis_confidence',
            'statistical_significance', 'summary_report',
            'recommendations', 'created_at', 'updated_at',
            'analysis_duration'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'server_name',
            'analysis_duration'
        ]
    
    def get_analysis_duration(self, obj):
        """Get duration of analysis period in days"""
        delta = obj.analysis_period_end - obj.analysis_period_start
        return delta.days


class TrainingJobSerializer(serializers.ModelSerializer):
    """Serializer for TrainingJob"""
    
    model_name = serializers.CharField(source='model.name', read_only=True)
    server_names = serializers.SerializerMethodField()
    estimated_completion = serializers.SerializerMethodField()
    
    class Meta:
        model = TrainingJob
        fields = [
            'id', 'model', 'model_name', 'servers', 'server_names',
            'training_config', 'data_range_start', 'data_range_end',
            'status', 'progress', 'training_logs', 'error_message',
            'final_metrics', 'cpu_usage', 'memory_usage', 'gpu_usage',
            'created_at', 'started_at', 'completed_at', 'duration',
            'estimated_completion'
        ]
        read_only_fields = [
            'id', 'created_at', 'started_at', 'completed_at',
            'duration', 'model_name', 'server_names', 'estimated_completion'
        ]
    
    def get_server_names(self, obj):
        """Get list of server hostnames"""
        return [server.hostname for server in obj.servers.all()]
    
    def get_estimated_completion(self, obj):
        """Estimate completion time based on progress"""
        if obj.status == 'running' and obj.progress > 0:
            elapsed = timezone.now() - obj.started_at
            total_estimated = elapsed.total_seconds() * (100 / obj.progress)
            remaining = total_estimated - elapsed.total_seconds()
            return f"{int(remaining // 60)} minutes remaining"
        return None


class AnomalyReportSerializer(serializers.ModelSerializer):
    """Serializer for AnomalyReport"""
    
    server_name = serializers.CharField(source='server.hostname', read_only=True)
    report_period_days = serializers.SerializerMethodField()
    anomaly_trend = serializers.SerializerMethodField()
    
    class Meta:
        model = AnomalyReport
        fields = [
            'id', 'server', 'server_name', 'report_type',
            'report_period_start', 'report_period_end',
            'executive_summary', 'total_anomalies', 'critical_anomalies',
            'high_anomalies', 'medium_anomalies', 'low_anomalies',
            'predictions_made', 'predictions_accuracy', 'false_positive_rate',
            'top_risk_metrics', 'trend_analysis', 'pattern_insights',
            'immediate_actions', 'preventive_measures',
            'monitoring_adjustments', 'generated_by', 'report_data',
            'created_at', 'updated_at', 'report_period_days', 'anomaly_trend'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'server_name',
            'report_period_days', 'anomaly_trend'
        ]
    
    def get_report_period_days(self, obj):
        """Get report period duration in days"""
        delta = obj.report_period_end - obj.report_period_start
        return delta.days
    
    def get_anomaly_trend(self, obj):
        """Determine overall anomaly trend"""
        total = obj.total_anomalies
        critical_high = obj.critical_anomalies + obj.high_anomalies
        
        if critical_high > total * 0.3:
            return "increasing"
        elif critical_high < total * 0.1:
            return "stable"
        else:
            return "moderate"


class ModelPerformanceMetricSerializer(serializers.ModelSerializer):
    """Serializer for ModelPerformanceMetric"""
    
    model_name = serializers.CharField(source='model.name', read_only=True)
    evaluation_period_days = serializers.SerializerMethodField()
    performance_grade = serializers.SerializerMethodField()
    
    class Meta:
        model = ModelPerformanceMetric
        fields = [
            'id', 'model', 'model_name', 'accuracy', 'precision',
            'recall', 'f1_score', 'auc_roc', 'false_positive_rate',
            'false_negative_rate', 'detection_latency', 'test_data_size',
            'evaluation_period_start', 'evaluation_period_end',
            'evaluated_at', 'evaluation_period_days', 'performance_grade'
        ]
        read_only_fields = [
            'id', 'evaluated_at', 'model_name',
            'evaluation_period_days', 'performance_grade'
        ]
    
    def get_evaluation_period_days(self, obj):
        """Get evaluation period duration in days"""
        delta = obj.evaluation_period_end - obj.evaluation_period_start
        return delta.days
    
    def get_performance_grade(self, obj):
        """Assign performance grade based on F1 score"""
        if obj.f1_score >= 0.9:
            return "A"
        elif obj.f1_score >= 0.8:
            return "B"
        elif obj.f1_score >= 0.7:
            return "C"
        elif obj.f1_score >= 0.6:
            return "D"
        else:
            return "F"


# Specialized serializers for analysis endpoints

class AnomalyAnalysisRequestSerializer(serializers.Serializer):
    """Serializer for anomaly analysis requests"""
    
    server_id = serializers.UUIDField()
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField()
    metric_types = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        default=list
    )
    include_predictions = serializers.BooleanField(default=True)
    include_correlations = serializers.BooleanField(default=True)
    analysis_depth = serializers.ChoiceField(
        choices=['basic', 'detailed', 'comprehensive'],
        default='detailed'
    )
    
    def validate(self, data):
        """Validate the analysis request"""
        if data['end_date'] <= data['start_date']:
            raise serializers.ValidationError(
                "End date must be after start date"
            )
        
        # Limit analysis period to prevent overload
        max_days = 90
        if (data['end_date'] - data['start_date']).days > max_days:
            raise serializers.ValidationError(
                f"Analysis period cannot exceed {max_days} days"
            )
        
        return data


class AnomalyAnalysisResponseSerializer(serializers.Serializer):
    """Serializer for anomaly analysis responses"""
    
    server_id = serializers.UUIDField()
    analysis_period = serializers.DictField()
    summary = serializers.DictField()
    anomalies = AnomalyDetectionSerializer(many=True, read_only=True)
    predictions = AnomalyPredictionSerializer(many=True, read_only=True)
    correlations = CorrelationAnalysisSerializer(read_only=True)
    recommendations = serializers.ListField(child=serializers.DictField())
    confidence_score = serializers.FloatField()
    generated_at = serializers.DateTimeField()


class PredictionRequestSerializer(serializers.Serializer):
    """Serializer for prediction requests"""
    
    server_id = serializers.UUIDField()
    prediction_horizon = serializers.ChoiceField(
        choices=['1h', '6h', '12h', '24h', '7d', '30d'],
        default='24h'
    )
    confidence_level = serializers.FloatField(
        min_value=0.1, max_value=0.99, default=0.95
    )
    include_recommendations = serializers.BooleanField(default=True)
    metric_focus = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        default=list
    )


class PredictionResponseSerializer(serializers.Serializer):
    """Serializer for prediction responses"""
    
    server_id = serializers.UUIDField()
    prediction_horizon = serializers.CharField()
    predictions = AnomalyPredictionSerializer(many=True, read_only=True)
    overall_risk_score = serializers.FloatField()
    risk_factors = serializers.ListField(child=serializers.DictField())
    recommendations = serializers.ListField(child=serializers.DictField())
    confidence_intervals = serializers.DictField()
    generated_at = serializers.DateTimeField()



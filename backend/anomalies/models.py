from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils import timezone
from django.contrib.postgres.fields import ArrayField
from django.db.models import JSONField
from .managers import (
    AnomalyModelManager, AnomalyDetectionManager, 
    AnomalyPredictionManager, TrainingJobManager,
    CorrelationAnalysisManager, ModelPerformanceMetricManager
)
import uuid
import json


class AnomalyModel(models.Model):
    """
    Stores trained ML models for anomaly detection
    """
    MODEL_TYPES = [
        ('lstm_autoencoder', 'LSTM Autoencoder'),
        ('isolation_forest', 'Isolation Forest'),
        ('one_class_svm', 'One-Class SVM'),
        ('statistical_control', 'Statistical Control'),
        ('ensemble', 'Ensemble Model'),
    ]
    
    STATUS_CHOICES = [
        ('training', 'Training'),
        ('ready', 'Ready'),
        ('failed', 'Failed'),
        ('outdated', 'Outdated'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    model_type = models.CharField(max_length=50, choices=MODEL_TYPES)
    version = models.CharField(max_length=20, default='1.0.0')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='training')
    
    # Model configuration
    config = JSONField(default=dict, help_text="Model hyperparameters and configuration")
    
    # Model artifacts storage paths
    model_path = models.CharField(max_length=500, help_text="Path to saved model files")
    preprocessor_path = models.CharField(max_length=500, blank=True, help_text="Path to preprocessor files")
    scaler_path = models.CharField(max_length=500, blank=True, help_text="Path to scaler files")
    
    # Performance metrics
    performance_metrics = JSONField(default=dict, help_text="Model performance statistics")
    threshold = models.FloatField(null=True, blank=True, help_text="Anomaly detection threshold")
    
    # Training metadata
    training_data_size = models.IntegerField(default=0)
    training_duration = models.FloatField(null=True, blank=True, help_text="Training duration in seconds")
    features_used = ArrayField(
        models.CharField(max_length=100),
        default=list,
        blank=True,
        help_text="List of features used for training"
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    trained_at = models.DateTimeField(null=True, blank=True)
    last_used = models.DateTimeField(null=True, blank=True)
    
    # Custom manager
    objects = AnomalyModelManager()
    
    class Meta:
        db_table = 'anomaly_models'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['model_type', 'status']),
            models.Index(fields=['status']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.model_type}) - {self.status}"
    
    def update_last_used(self):
        """Update the last used timestamp"""
        self.last_used = timezone.now()
        self.save(update_fields=['last_used'])
    
    @property
    def is_active(self):
        """Check if model is actively being used"""
        return (self.status == 'ready' and 
                self.last_used and 
                timezone.now() - self.last_used < timezone.timedelta(days=7))
    
    @property 
    def performance_grade(self):
        """Get performance grade based on F1 score"""
        f1 = self.performance_metrics.get('ensemble', {}).get('f1_score', 0)
        if f1 >= 0.9:
            return "A"
        elif f1 >= 0.8:
            return "B"
        elif f1 >= 0.7:
            return "C"
        elif f1 >= 0.6:
            return "D"
        else:
            return "F"


class AnomalyDetection(models.Model):
    """
    Store anomaly detection results
    """
    SEVERITY_LEVELS = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ]
    
    STATUS_CHOICES = [
        ('new', 'New'),
        ('acknowledged', 'Acknowledged'),
        ('resolved', 'Resolved'),
        ('false_positive', 'False Positive'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey('metrics.Server', on_delete=models.CASCADE, related_name='anomalies')
    model = models.ForeignKey(AnomalyModel, on_delete=models.CASCADE, related_name='detections')
    
    # Detection details
    timestamp = models.DateTimeField(db_index=True)
    anomaly_score = models.FloatField(help_text="Anomaly score from 0 to 1")
    confidence = models.FloatField(help_text="Confidence level of detection")
    severity = models.CharField(max_length=20, choices=SEVERITY_LEVELS)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new')
    
    # Anomaly data
    metric_values = JSONField(help_text="Actual metric values at time of anomaly")
    features_contributing = JSONField(default=list, help_text="Features that contributed most to anomaly")
    expected_values = JSONField(default=dict, help_text="Expected normal values")
    deviation_percentages = JSONField(default=dict, help_text="Deviation from normal in percentage")
    
    # Additional context
    description = models.TextField(blank=True, help_text="Auto-generated description of anomaly")
    tags = ArrayField(
        models.CharField(max_length=50),
        default=list,
        blank=True,
        help_text="Tags for categorization"
    )
    
    # Model ensemble results
    individual_scores = JSONField(default=dict, help_text="Scores from individual models in ensemble")
    model_agreement = models.FloatField(null=True, blank=True, help_text="Agreement between models")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    
    # Custom manager
    objects = AnomalyDetectionManager()
    
    class Meta:
        db_table = 'anomaly_detections'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['server', '-timestamp']),
            models.Index(fields=['severity', 'status']),
            models.Index(fields=['timestamp']),
            models.Index(fields=['anomaly_score']),
        ]
    
    def __str__(self):
        return f"Anomaly on {self.server.hostname} at {self.timestamp} - {self.severity}"
    
    @property
    def time_since_detection(self):
        """Get human-readable time since detection"""
        delta = timezone.now() - self.timestamp
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
    
    def acknowledge(self, user=None):
        """Mark anomaly as acknowledged"""
        self.status = 'acknowledged'
        self.acknowledged_at = timezone.now()
        self.save(update_fields=['status', 'acknowledged_at'])
    
    def resolve(self, user=None):
        """Mark anomaly as resolved"""
        self.status = 'resolved'
        self.resolved_at = timezone.now()
        self.save(update_fields=['status', 'resolved_at'])


class AnomalyPrediction(models.Model):
    """
    Store future anomaly predictions
    """
    PREDICTION_TYPES = [
        ('short_term', 'Short Term (1-24 hours)'),
        ('medium_term', 'Medium Term (1-7 days)'),
        ('long_term', 'Long Term (1-30 days)'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey('metrics.Server', on_delete=models.CASCADE, related_name='anomaly_predictions')
    model = models.ForeignKey(AnomalyModel, on_delete=models.CASCADE, related_name='predictions')
    
    # Prediction details
    prediction_type = models.CharField(max_length=20, choices=PREDICTION_TYPES)
    predicted_timestamp = models.DateTimeField(help_text="When anomaly is predicted to occur")
    probability = models.FloatField(
        validators=[MinValueValidator(0.0), MaxValueValidator(1.0)],
        help_text="Probability of anomaly occurring (0-1)"
    )
    confidence_interval = JSONField(
        default=dict,
        help_text="Confidence intervals for the prediction"
    )
    
    # Prediction context
    predicted_metrics = JSONField(help_text="Predicted metric values")
    risk_factors = ArrayField(
        models.CharField(max_length=100),
        default=list,
        help_text="Identified risk factors"
    )
    recommendations = JSONField(default=list, help_text="Recommended actions")
    
    # Time series forecast data
    forecast_data = JSONField(default=dict, help_text="Full forecast time series data")
    seasonality_detected = models.BooleanField(default=False)
    trend_direction = models.CharField(
        max_length=20,
        choices=[('increasing', 'Increasing'), ('decreasing', 'Decreasing'), ('stable', 'Stable')],
        default='stable'
    )
    
    # Validation tracking
    is_validated = models.BooleanField(default=False)
    actual_occurred = models.BooleanField(null=True, blank=True)
    validation_date = models.DateTimeField(null=True, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Custom manager
    objects = AnomalyPredictionManager()
    
    class Meta:
        db_table = 'anomaly_predictions'
        ordering = ['predicted_timestamp']
        indexes = [
            models.Index(fields=['server', 'predicted_timestamp']),
            models.Index(fields=['prediction_type']),
            models.Index(fields=['probability']),
        ]
    
    def __str__(self):
        return f"Prediction for {self.server.hostname} at {self.predicted_timestamp} - {self.probability:.2%}"
    
    @property
    def time_until_prediction(self):
        """Get human-readable time until predicted event"""
        delta = self.predicted_timestamp - timezone.now()
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
    
    @property
    def risk_level(self):
        """Determine risk level based on probability"""
        if self.probability >= 0.8:
            return "high"
        elif self.probability >= 0.6:
            return "medium"
        else:
            return "low"
    
    def validate_prediction(self, occurred=False):
        """Validate the prediction with actual outcome"""
        self.is_validated = True
        self.actual_occurred = occurred
        self.validation_date = timezone.now()
        self.save(update_fields=['is_validated', 'actual_occurred', 'validation_date'])


class CorrelationAnalysis(models.Model):
    """
    Store correlation analysis between different metrics and anomalies
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey('metrics.Server', on_delete=models.CASCADE, related_name='correlation_analyses')
    
    # Analysis parameters
    analysis_period_start = models.DateTimeField()
    analysis_period_end = models.DateTimeField()
    metric_types_analyzed = ArrayField(
        models.CharField(max_length=50),
        help_text="Types of metrics included in analysis"
    )
    
    # Correlation results
    correlation_matrix = JSONField(help_text="Full correlation matrix between metrics")
    strong_correlations = JSONField(
        default=list,
        help_text="List of strongly correlated metric pairs"
    )
    anomaly_correlations = JSONField(
        default=dict,
        help_text="Correlations between metrics and anomaly occurrences"
    )
    
    # Key findings
    top_anomaly_indicators = JSONField(
        default=list,
        help_text="Metrics that are best predictors of anomalies"
    )
    seasonal_patterns = JSONField(
        default=dict,
        help_text="Detected seasonal patterns in metrics"
    )
    anomaly_clusters = JSONField(
        default=list,
        help_text="Identified clusters of related anomalies"
    )
    
    # Statistical measures
    total_anomalies_analyzed = models.IntegerField(default=0)
    analysis_confidence = models.FloatField(help_text="Confidence level of analysis results")
    statistical_significance = JSONField(
        default=dict,
        help_text="P-values and significance tests results"
    )
    
    # Report generation
    summary_report = models.TextField(help_text="Auto-generated summary of findings")
    recommendations = JSONField(default=list, help_text="Recommended monitoring strategies")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Custom manager
    objects = CorrelationAnalysisManager()
    
    class Meta:
        db_table = 'correlation_analyses'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['server', '-created_at']),
            models.Index(fields=['analysis_period_start', 'analysis_period_end']),
        ]
    
    def __str__(self):
        return f"Correlation Analysis for {self.server.hostname} - {self.created_at}"
    
    @property
    def analysis_duration_days(self):
        """Get analysis period duration in days"""
        return (self.analysis_period_end - self.analysis_period_start).days


class TrainingJob(models.Model):
    """
    Track model training jobs
    """
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    model = models.ForeignKey(AnomalyModel, on_delete=models.CASCADE, related_name='training_jobs')
    servers = models.ManyToManyField('metrics.Server', related_name='training_jobs')
    
    # Job configuration
    training_config = JSONField(help_text="Training parameters and configuration")
    data_range_start = models.DateTimeField(help_text="Start of training data range")
    data_range_end = models.DateTimeField(help_text="End of training data range")
    
    # Job status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='queued')
    progress = models.FloatField(default=0.0, validators=[MinValueValidator(0.0), MaxValueValidator(100.0)])
    
    # Results
    training_logs = models.TextField(blank=True, help_text="Training process logs")
    error_message = models.TextField(blank=True)
    final_metrics = JSONField(default=dict, help_text="Final training metrics")
    
    # Resource usage
    cpu_usage = models.FloatField(null=True, blank=True)
    memory_usage = models.FloatField(null=True, blank=True)
    gpu_usage = models.FloatField(null=True, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True, help_text="Job duration in seconds")
    
    # Custom manager
    objects = TrainingJobManager()
    
    class Meta:
        db_table = 'training_jobs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['-created_at']),
        ]
    
    def __str__(self):
        return f"Training Job for {self.model.name} - {self.status}"
    
    @property
    def estimated_completion(self):
        """Estimate completion time based on current progress"""
        if self.status == 'running' and self.progress > 0 and self.started_at:
            elapsed = timezone.now() - self.started_at
            total_estimated = elapsed.total_seconds() * (100 / self.progress)
            remaining = total_estimated - elapsed.total_seconds()
            return f"{int(remaining // 60)} minutes remaining"
        return None


class AnomalyReport(models.Model):
    """
    Generated reports combining detection, prediction, and correlation analysis
    """
    REPORT_TYPES = [
        ('daily', 'Daily Report'),
        ('weekly', 'Weekly Report'),
        ('monthly', 'Monthly Report'),
        ('custom', 'Custom Report'),
        ('incident', 'Incident Report'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey('metrics.Server', on_delete=models.CASCADE, related_name='anomaly_reports')
    
    # Report configuration
    report_type = models.CharField(max_length=20, choices=REPORT_TYPES)
    report_period_start = models.DateTimeField()
    report_period_end = models.DateTimeField()
    
    # Report content
    executive_summary = models.TextField(help_text="High-level summary of findings")
    
    # Anomaly statistics
    total_anomalies = models.IntegerField(default=0)
    critical_anomalies = models.IntegerField(default=0)
    high_anomalies = models.IntegerField(default=0)
    medium_anomalies = models.IntegerField(default=0)
    low_anomalies = models.IntegerField(default=0)
    
    # Prediction statistics
    predictions_made = models.IntegerField(default=0)
    predictions_accuracy = models.FloatField(null=True, blank=True)
    false_positive_rate = models.FloatField(null=True, blank=True)
    
    # Key insights
    top_risk_metrics = JSONField(default=list, help_text="Metrics with highest anomaly risk")
    trend_analysis = JSONField(default=dict, help_text="Trend analysis results")
    pattern_insights = JSONField(default=list, help_text="Detected patterns and insights")
    
    # Recommendations
    immediate_actions = JSONField(default=list, help_text="Recommended immediate actions")
    preventive_measures = JSONField(default=list, help_text="Recommended preventive measures")
    monitoring_adjustments = JSONField(default=list, help_text="Suggested monitoring improvements")
    
    # Report metadata
    generated_by = models.CharField(max_length=100, default='system')
    report_data = JSONField(default=dict, help_text="Complete report data for visualization")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'anomaly_reports'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['server', 'report_type']),
            models.Index(fields=['report_period_start', 'report_period_end']),
        ]
    
    def __str__(self):
        return f"{self.report_type.title()} Report for {self.server.hostname} - {self.created_at}"
    
    @property
    def report_period_days(self):
        """Get report period duration in days"""
        return (self.report_period_end - self.report_period_start).days
    
    @property
    def anomaly_trend(self):
        """Determine overall anomaly trend"""
        if self.total_anomalies == 0:
            return "stable"
        
        critical_high = self.critical_anomalies + self.high_anomalies
        
        if critical_high > self.total_anomalies * 0.3:
            return "increasing"
        elif critical_high < self.total_anomalies * 0.1:
            return "stable"
        else:
            return "moderate"


class ModelPerformanceMetric(models.Model):
    """
    Track model performance over time
    """
    model = models.ForeignKey(AnomalyModel, on_delete=models.CASCADE, related_name='performance_history')
    
    # Performance metrics
    accuracy = models.FloatField()
    precision = models.FloatField()
    recall = models.FloatField()
    f1_score = models.FloatField()
    auc_roc = models.FloatField()
    
    # Additional metrics
    false_positive_rate = models.FloatField()
    false_negative_rate = models.FloatField()
    detection_latency = models.FloatField(help_text="Average detection latency in seconds")
    
    # Test data information
    test_data_size = models.IntegerField()
    evaluation_period_start = models.DateTimeField()
    evaluation_period_end = models.DateTimeField()
    
    # Timestamps
    evaluated_at = models.DateTimeField(auto_now_add=True)
    
    # Custom manager
    objects = ModelPerformanceMetricManager()
    
    class Meta:
        db_table = 'model_performance_metrics'
        ordering = ['-evaluated_at']
        indexes = [
            models.Index(fields=['model', '-evaluated_at']),
        ]
    
    def __str__(self):
        return f"Performance for {self.model.name} - F1: {self.f1_score:.3f}"
    
    @property
    def evaluation_period_days(self):
        """Get evaluation period duration in days"""
        return (self.evaluation_period_end - self.evaluation_period_start).days
    
    @property
    def performance_grade(self):
        """Assign performance grade based on F1 score"""
        if self.f1_score >= 0.9:
            return "A"
        elif self.f1_score >= 0.8:
            return "B"
        elif self.f1_score >= 0.7:
            return "C"
        elif self.f1_score >= 0.6:
            return "D"
        else:
            return "F"


# Additional model for storing raw anomaly detection results (from your views.py)
class AnomalyDetectionResult(models.Model):
    """
    Store raw anomaly detection results from ML model inference
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server_id = models.UUIDField(null=True, blank=True)  # Commented out as in your views.py
    timestamp = models.DateTimeField(db_index=True)
    is_anomaly = models.BooleanField()
    anomaly_score = models.FloatField(help_text="Raw anomaly score from model")
    metric_values = JSONField(help_text="Metric values at time of detection")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'anomaly_detection_results'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['timestamp']),
            models.Index(fields=['is_anomaly']),
            models.Index(fields=['anomaly_score']),
        ]
    
    def __str__(self):
        anomaly_status = "Anomaly" if self.is_anomaly else "Normal"
        return f"{anomaly_status} at {self.timestamp} - Score: {self.anomaly_score:.3f}"


# Model for tracking feature importance over time
class FeatureImportance(models.Model):
    """
    Track feature importance scores over time for different models
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    model = models.ForeignKey(AnomalyModel, on_delete=models.CASCADE, related_name='feature_importances')
    
    # Feature data
    feature_scores = JSONField(help_text="Feature importance scores")
    feature_ranking = ArrayField(
        models.CharField(max_length=100),
        help_text="Features ranked by importance"
    )
    
    # Analysis metadata
    analysis_method = models.CharField(
        max_length=50,
        choices=[
            ('permutation', 'Permutation Importance'),
            ('shap', 'SHAP Values'),
            ('lime', 'LIME Analysis'),
            ('feature_ablation', 'Feature Ablation'),
        ],
        default='permutation'
    )
    
    data_period_start = models.DateTimeField()
    data_period_end = models.DateTimeField()
    sample_size = models.IntegerField()
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'feature_importances'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['model', '-created_at']),
        ]
    
    def __str__(self):
        return f"Feature Importance for {self.model.name} - {self.created_at}"
    
    @property
    def top_features(self, limit=5):
        """Get top N most important features"""
        return self.feature_ranking[:limit]


# Model for tracking anomaly detection thresholds and their effectiveness
class ThresholdOptimization(models.Model):
    """
    Track threshold optimization experiments and results
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    model = models.ForeignKey(AnomalyModel, on_delete=models.CASCADE, related_name='threshold_optimizations')
    
    # Threshold details
    threshold_value = models.FloatField()
    optimization_metric = models.CharField(
        max_length=50,
        choices=[
            ('f1_score', 'F1 Score'),
            ('precision', 'Precision'),
            ('recall', 'Recall'),
            ('balanced', 'Balanced Precision-Recall'),
        ],
        default='f1_score'
    )
    
    # Results
    precision = models.FloatField()
    recall = models.FloatField()
    f1_score = models.FloatField()
    false_positive_rate = models.FloatField()
    false_negative_rate = models.FloatField()
    
    # Test data
    test_data_size = models.IntegerField()
    test_period_start = models.DateTimeField()
    test_period_end = models.DateTimeField()
    
    # Selection tracking
    is_selected = models.BooleanField(default=False)
    selection_reason = models.TextField(blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'threshold_optimizations'
        ordering = ['-f1_score']
        indexes = [
            models.Index(fields=['model', '-f1_score']),
            models.Index(fields=['is_selected']),
        ]
    
    def __str__(self):
        return f"Threshold {self.threshold_value} for {self.model.name} - F1: {self.f1_score:.3f}"
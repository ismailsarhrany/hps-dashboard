"""
Utility functions for anomaly detection and prediction
"""

import numpy as np
import pandas as pd
from django.utils import timezone
from datetime import timedelta
from django.core.cache import cache
from django.db.models import Count, Avg, Q
import logging

logger = logging.getLogger(__name__)


def calculate_anomaly_severity(anomaly_score, confidence, threshold=0.5):
    """
    Calculate anomaly severity based on score, confidence, and threshold
    
    Args:
        anomaly_score (float): Raw anomaly score from model
        confidence (float): Model confidence (0-1)
        threshold (float): Detection threshold
    
    Returns:
        str: Severity level ('low', 'medium', 'high', 'critical')
    """
    # Combine score and confidence for risk assessment
    risk_factor = abs(anomaly_score) * confidence
    
    if risk_factor >= threshold * 1.6:
        return 'critical'
    elif risk_factor >= threshold * 1.3:
        return 'high'
    elif risk_factor >= threshold:
        return 'medium'
    else:
        return 'low'


def generate_anomaly_tags(features_contributing, metric_values=None):
    """
    Generate relevant tags for anomaly based on contributing features
    
    Args:
        features_contributing (list): List of contributing features
        metric_values (dict): Optional metric values for context
    
    Returns:
        list: List of relevant tags
    """
    tags = []
    
    # Feature categories
    feature_categories = {
        'cpu': {'us', 'sy', 'idle', 'cpu_user', 'cpu_system', 'cpu_idle'},
        'memory': {'avm', 'fre', 'mem_active', 'mem_free', 'memory_usage'},
        'disk': {'tps', 'kb_read', 'kb_wrtn', 'disk_usage', 'io_wait'},
        'network': {'ipkts', 'opkts', 'net_in', 'net_out', 'network_errors'}
    }
    
    # Check which categories are involved
    for category, feature_set in feature_categories.items():
        if any(feature in features_contributing for feature in feature_set):
            tags.append(category)
    
    # Add specific tags based on metric values
    if metric_values:
        # High CPU usage
        cpu_user = metric_values.get('us', 0)
        if cpu_user and cpu_user > 80:
            tags.append('high_cpu')
        
        # Low memory
        mem_free = metric_values.get('fre', 0)
        if mem_free and mem_free < 10:  # Less than 10% free
            tags.append('low_memory')
        
        # High disk activity
        disk_tps = metric_values.get('tps', 0)
        if disk_tps and disk_tps > 1000:
            tags.append('high_io')
    
    return list(set(tags))  # Remove duplicates


def calculate_prediction_confidence(model_scores, historical_accuracy=None):
    """
    Calculate confidence for anomaly predictions
    
    Args:
        model_scores (dict): Scores from individual models
        historical_accuracy (float): Historical accuracy of the model
    
    Returns:
        float: Confidence score (0-1)
    """
    if not model_scores:
        return 0.5
    
    # Base confidence on model agreement and historical performance
    scores = list(model_scores.values())
    
    # Calculate variance in scores (lower variance = higher agreement)
    if len(scores) > 1:
        variance = np.var(scores)
        agreement_factor = max(0, 1 - variance)
    else:
        agreement_factor = 0.8  # Default for single model
    
    # Factor in historical accuracy if available
    if historical_accuracy:
        confidence = (agreement_factor * 0.7) + (historical_accuracy * 0.3)
    else:
        confidence = agreement_factor
    
    return min(max(confidence, 0.1), 0.99)  # Clamp between 0.1 and 0.99


def get_baseline_metrics(server, metric_types, days=30):
    """
    Get baseline metrics for a server to compare against anomalies
    
    Args:
        server: Server instance
        metric_types (list): Types of metrics to get baselines for
        days (int): Number of days to look back for baseline
    
    Returns:
        dict: Baseline statistics for each metric
    """
    cache_key = f'baseline_metrics_{server.id}_{days}d'
    cached_result = cache.get(cache_key)
    
    if cached_result:
        return cached_result
    
    # This would need to be implemented based on your metrics app structure
    # Here's a placeholder that you can adapt
    baselines = {}
    
    try:
        from anomalies.models import AnomalyDetectionResult
        
        # Get recent non-anomaly data points
        cutoff = timezone.now() - timedelta(days=days)
        normal_data = AnomalyDetectionResult.objects.filter(
            timestamp__gte=cutoff,
            is_anomaly=False
        ).values_list('metric_values', flat=True)
        
        if normal_data:
            # Calculate statistics for each metric
            all_metrics = {}
            for metric_dict in normal_data:
                for metric, value in metric_dict.items():
                    if metric not in all_metrics:
                        all_metrics[metric] = []
                    if value is not None:
                        all_metrics[metric].append(value)
            
            # Calculate baselines
            for metric, values in all_metrics.items():
                if values and metric in metric_types:
                    baselines[metric] = {
                        'mean': np.mean(values),
                        'std': np.std(values),
                        'median': np.median(values),
                        'min': np.min(values),
                        'max': np.max(values),
                        'percentile_95': np.percentile(values, 95),
                        'percentile_5': np.percentile(values, 5)
                    }
        
        # Cache for 1 hour
        cache.set(cache_key, baselines, 3600)
        
    except Exception as e:
        logger.error(f"Error calculating baselines for {server.hostname}: {e}")
        baselines = {}
    
    return baselines


def calculate_deviation_percentages(current_values, baseline_metrics):
    """
    Calculate percentage deviations from baseline values
    
    Args:
        current_values (dict): Current metric values
        baseline_metrics (dict): Baseline statistics
    
    Returns:
        dict: Deviation percentages for each metric
    """
    deviations = {}
    
    for metric, current_value in current_values.items():
        if metric in baseline_metrics and current_value is not None:
            baseline = baseline_metrics[metric]
            baseline_mean = baseline.get('mean', 0)
            
            if baseline_mean != 0:
                deviation = ((current_value - baseline_mean) / baseline_mean) * 100
                deviations[metric] = round(deviation, 2)
            else:
                deviations[metric] = 0.0
    
    return deviations


def get_expected_values(metric_values, baseline_metrics):
    """
    Get expected values based on baseline statistics
    
    Args:
        metric_values (dict): Current metric values
        baseline_metrics (dict): Baseline statistics
    
    Returns:
        dict: Expected values for each metric
    """
    expected = {}
    
    for metric in metric_values.keys():
        if metric in baseline_metrics:
            baseline = baseline_metrics[metric]
            # Use median as expected value (more robust than mean)
            expected[metric] = baseline.get('median', baseline.get('mean', 0))
        else:
            expected[metric] = 0
    
    return expected


def calculate_model_agreement(individual_scores):
    """
    Calculate agreement between multiple models in ensemble
    
    Args:
        individual_scores (dict): Scores from individual models
    
    Returns:
        float: Agreement score (0-1, higher is better agreement)
    """
    if not individual_scores or len(individual_scores) < 2:
        return 1.0  # Perfect agreement for single model
    
    scores = list(individual_scores.values())
    
    # Calculate coefficient of variation (lower is better agreement)
    mean_score = np.mean(scores)
    if mean_score == 0:
        return 1.0
    
    cv = np.std(scores) / abs(mean_score)
    
    # Convert to agreement score (0-1, where 1 is perfect agreement)
    agreement = max(0, 1 - cv)
    return min(agreement, 1.0)


def get_anomaly_dashboard_stats(server_id=None, hours=24):
    """
    Get dashboard statistics for anomaly overview
    
    Args:
        server_id (UUID): Optional server filter
        hours (int): Time window for recent stats
    
    Returns:
        dict: Dashboard statistics
    """
    from anomalies.models import AnomalyDetection, AnomalyPrediction
    
    cache_key = f'dashboard_stats_{server_id}_{hours}h'
    cached_result = cache.get(cache_key)
    
    if cached_result:
        return cached_result
    
    cutoff = timezone.now() - timedelta(hours=hours)
    
    # Base querysets
    detections_qs = AnomalyDetection.objects.filter(timestamp__gte=cutoff)
    predictions_qs = AnomalyPrediction.objects.active()
    
    if server_id:
        detections_qs = detections_qs.filter(server_id=server_id)
        predictions_qs = predictions_qs.filter(server_id=server_id)
    
    # Calculate statistics
    stats = {
        'total_anomalies': detections_qs.count(),
        'unresolved_anomalies': detections_qs.unresolved().count(),
        'critical_anomalies': detections_qs.filter(severity='critical').count(),
        'avg_anomaly_score': detections_qs.aggregate(
            avg=Avg('anomaly_score')
        )['avg'] or 0,
        'active_predictions': predictions_qs.count(),
        'high_prob_predictions': predictions_qs.filter(probability__gte=0.7).count(),
        'imminent_predictions': predictions_qs.filter(
            predicted_timestamp__lte=timezone.now() + timedelta(hours=6)
        ).count(),
    }
    
    # Severity breakdown
    severity_counts = detections_qs.values('severity').annotate(
        count=Count('id')
    ).order_by('severity')
    
    stats['severity_breakdown'] = {
        item['severity']: item['count'] for item in severity_counts
    }
    
    # Cache for 5 minutes
    cache.set(cache_key, stats, 300)
    
    return stats


def validate_model_performance(model):
    """
    Validate if a model's performance is still acceptable
    
    Args:
        model: AnomalyModel instance
    
    Returns:
        dict: Validation results with recommendations
    """
    from anomalies.models import ModelPerformanceMetric
    
    # Get recent performance metrics
    recent_metrics = ModelPerformanceMetric.objects.filter(
        model=model,
        evaluated_at__gte=timezone.now() - timedelta(days=30)
    ).order_by('-evaluated_at')
    
    if not recent_metrics.exists():
        return {
            'status': 'unknown',
            'message': 'No recent performance data available',
            'recommendation': 'Run model evaluation'
        }
    
    latest_metric = recent_metrics.first()
    
    # Performance thresholds
    min_f1_score = 0.7
    min_precision = 0.6
    max_false_positive_rate = 0.1
    
    issues = []
    
    if latest_metric.f1_score < min_f1_score:
        issues.append(f"Low F1 score: {latest_metric.f1_score:.3f}")
    
    if latest_metric.precision < min_precision:
        issues.append(f"Low precision: {latest_metric.precision:.3f}")
    
    if latest_metric.false_positive_rate > max_false_positive_rate:
        issues.append(f"High false positive rate: {latest_metric.false_positive_rate:.3f}")
    
    if issues:
        return {
            'status': 'degraded',
            'message': 'Performance below acceptable thresholds',
            'issues': issues,
            'recommendation': 'Consider retraining model with recent data'
        }
    
    # Check for performance trend
    if recent_metrics.count() >= 3:
        scores = list(recent_metrics.values_list('f1_score', flat=True))[:3]
        if all(scores[i] <= scores[i+1] for i in range(len(scores)-1)):
            return {
                'status': 'declining',
                'message': 'Performance trend is declining',
                'recommendation': 'Monitor closely and consider retraining'
            }
    
    return {
        'status': 'good',
        'message': 'Model performance is acceptable',
        'recommendation': 'Continue monitoring'
    }


def get_feature_importance_summary(model, limit=10):
    """
    Get feature importance summary for a model
    
    Args:
        model: AnomalyModel instance
        limit (int): Number of top features to return
    
    Returns:
        dict: Feature importance data
    """
    from anomalies.models import FeatureImportance
    
    latest_analysis = FeatureImportance.objects.filter(
        model=model
    ).order_by('-created_at').first()
    
    if not latest_analysis:
        return {
            'available': False,
            'message': 'No feature importance analysis available'
        }
    
    feature_scores = latest_analysis.feature_scores
    top_features = latest_analysis.feature_ranking[:limit]
    
    return {
        'available': True,
        'top_features': [
            {
                'feature': feature,
                'importance': feature_scores.get(feature, 0),
                'rank': idx + 1
            }
            for idx, feature in enumerate(top_features)
        ],
        'analysis_date': latest_analysis.created_at,
        'analysis_method': latest_analysis.analysis_method
    }


def optimize_detection_threshold(model, validation_data, metric='f1_score'):
    """
    Find optimal threshold for anomaly detection
    
    Args:
        model: AnomalyModel instance
        validation_data (DataFrame): Validation dataset with true labels
        metric (str): Optimization metric ('f1_score', 'precision', 'recall')
    
    Returns:
        dict: Optimal threshold and performance metrics
    """
    from sklearn.metrics import precision_recall_curve, f1_score, precision_score, recall_score
    
    # This is a simplified implementation - you'd need to adapt based on your model type
    thresholds = np.arange(0.1, 1.0, 0.05)
    best_threshold = 0.5
    best_score = 0
    threshold_results = []
    
    # Assuming you have a way to get anomaly scores for validation data
    # This would need to be implemented based on your specific model loading logic
    
    for threshold in thresholds:
        # Apply threshold to get predictions
        predictions = validation_data['anomaly_score'] <= -threshold  # For isolation forest
        true_labels = validation_data['is_anomaly']
        
        if metric == 'f1_score':
            score = f1_score(true_labels, predictions)
        elif metric == 'precision':
            score = precision_score(true_labels, predictions, zero_division=0)
        elif metric == 'recall':
            score = recall_score(true_labels, predictions, zero_division=0)
        
        threshold_results.append({
            'threshold': threshold,
            'score': score,
            'precision': precision_score(true_labels, predictions, zero_division=0),
            'recall': recall_score(true_labels, predictions, zero_division=0)
        })
        
        if score > best_score:
            best_score = score
            best_threshold = threshold
    
    return {
        'optimal_threshold': best_threshold,
        'best_score': best_score,
        'optimization_metric': metric,
        'threshold_analysis': threshold_results
    }


def generate_anomaly_description(server_hostname, features_contributing, metric_values=None):
    """
    Generate human-readable description for an anomaly
    
    Args:
        server_hostname (str): Server hostname
        features_contributing (list): Contributing features
        metric_values (dict): Optional metric values
    
    Returns:
        str: Human-readable anomaly description
    """
    if not features_contributing:
        return f"Anomaly detected on {server_hostname}"
    
    # Feature descriptions
    feature_descriptions = {
        'us': 'high CPU user time',
        'sy': 'high CPU system time',
        'idle': 'low CPU idle time',
        'avm': 'abnormal active memory usage',
        'fre': 'low free memory',
        'tps': 'unusual disk transfer rate',
        'ipkts': 'high network input packets',
        'opkts': 'high network output packets',
    }
    
    # Get top 3 contributing features
    top_features = features_contributing[:3]
    descriptions = []
    
    for feature in top_features:
        desc = feature_descriptions.get(feature, f'unusual {feature}')
        
        # Add specific values if available
        if metric_values and feature in metric_values:
            value = metric_values[feature]
            if value is not None:
                desc += f' ({value:.2f})'
        
        descriptions.append(desc)
    
    # Format description
    if len(descriptions) == 1:
        detail = descriptions[0]
    elif len(descriptions) == 2:
        detail = f"{descriptions[0]} and {descriptions[1]}"
    else:
        detail = f"{', '.join(descriptions[:-1])}, and {descriptions[-1]}"
    
    return f"Anomaly detected on {server_hostname}: {detail}"


def get_anomaly_trends(server_id=None, days=7):
    """
    Calculate anomaly trends over time
    
    Args:
        server_id (UUID): Optional server filter
        days (int): Number of days to analyze
    
    Returns:
        dict: Trend analysis results
    """
    from anomalies.models import AnomalyDetection
    
    cache_key = f'anomaly_trends_{server_id}_{days}d'
    cached_result = cache.get(cache_key)
    
    if cached_result:
        return cached_result
    
    cutoff = timezone.now() - timedelta(days=days)
    
    # Base queryset
    qs = AnomalyDetection.objects.filter(timestamp__gte=cutoff)
    if server_id:
        qs = qs.filter(server_id=server_id)
    
    # Daily counts
    daily_counts = {}
    for i in range(days):
        day = cutoff + timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        
        count = qs.filter(
            timestamp__gte=day_start,
            timestamp__lt=day_end
        ).count()
        
        daily_counts[day.strftime('%Y-%m-%d')] = count
    
    # Calculate trend
    counts = list(daily_counts.values())
    if len(counts) >= 3:
        recent_avg = np.mean(counts[-3:])
        earlier_avg = np.mean(counts[:3]) if len(counts) >= 6 else np.mean(counts[:-3])
        
        if recent_avg > earlier_avg * 1.2:
            trend = 'increasing'
        elif recent_avg < earlier_avg * 0.8:
            trend = 'decreasing'
        else:
            trend = 'stable'
    else:
        trend = 'insufficient_data'
    
    result = {
        'trend': trend,
        'daily_counts': daily_counts,
        'total_anomalies': sum(counts),
        'avg_daily': np.mean(counts),
        'max_daily': max(counts),
        'min_daily': min(counts)
    }
    
    # Cache for 30 minutes
    cache.set(cache_key, result, 1800)
    
    return result


def cleanup_old_data(days_to_keep=90):
    """
    Clean up old anomaly detection data
    
    Args:
        days_to_keep (int): Number of days of data to retain
    
    Returns:
        dict: Cleanup summary
    """
    from anomalies.models import (
        AnomalyDetectionResult, AnomalyDetection, 
        AnomalyPrediction, TrainingJob
    )
    
    cutoff = timezone.now() - timedelta(days=days_to_keep)
    
    # Count records to be deleted
    old_results = AnomalyDetectionResult.objects.filter(created_at__lt=cutoff)
    old_detections = AnomalyDetection.objects.filter(
        created_at__lt=cutoff, 
        status__in=['resolved', 'false_positive']
    )
    old_predictions = AnomalyPrediction.objects.filter(
        predicted_timestamp__lt=cutoff,
        is_validated=True
    )
    old_training_jobs = TrainingJob.objects.filter(
        created_at__lt=cutoff,
        status__in=['completed', 'failed', 'cancelled']
    )
    
    summary = {
        'detection_results_deleted': old_results.count(),
        'detections_deleted': old_detections.count(),
        'predictions_deleted': old_predictions.count(),
        'training_jobs_deleted': old_training_jobs.count(),
    }
    
    # Perform deletion
    old_results.delete()
    old_detections.delete()
    old_predictions.delete()
    old_training_jobs.delete()
    
    logger.info(f"Cleanup completed: {summary}")
    
    return summary
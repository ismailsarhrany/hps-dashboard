# utils/rate_service.py

import time
import logging
from datetime import datetime, timezone
from typing import Dict, Optional, Union

logger = logging.getLogger(__name__)

class RateCalculatorService:
    """Calculates rates for cumulative metrics using an in-memory cache."""

    def __init__(self, min_time_diff_seconds: float = 0.1):
        """Initializes the service with caches for previous values."""
        self._previous_netstat_values = {}
        self._previous_iostat_values = {}
        self.min_time_diff_seconds = min_time_diff_seconds
        logger.info(f"RateCalculatorService initialized with min_time_diff: {min_time_diff_seconds}s")

    def _parse_timestamp(self, timestamp_str: str) -> Optional[float]:
        """Parses ISO timestamp string to POSIX timestamp (seconds)."""
        if not timestamp_str:
            logger.warning("Empty timestamp provided")
            return None
            
        try:
            # Handle potential timezone info (like +00:00 or Z)
            if timestamp_str.endswith('Z'):
                timestamp_str = timestamp_str.replace("Z", "+00:00")
            
            dt = datetime.fromisoformat(timestamp_str)
            
            # Convert to UTC if timezone-aware, otherwise assume UTC
            if dt.tzinfo is not None and dt.tzinfo.utcoffset(dt) is not None:
                return dt.timestamp()
            else:
                # Assume UTC if naive
                return dt.replace(tzinfo=timezone.utc).timestamp()
                
        except (ValueError, TypeError) as e:
            logger.error(f"Error parsing timestamp '{timestamp_str}': {e}")
            return None

    def _safe_float_conversion(self, value: Union[str, int, float], default: float = 0.0) -> float:
        """Safely converts value to float with error handling."""
        try:
            if value is None:
                return default
            return float(value)
        except (ValueError, TypeError) as e:
            logger.warning(f"Could not convert value '{value}' to float: {e}")
            return default

    def _calculate_single_rate(self, cache: dict, key: str, current_timestamp_sec: float, current_value: float) -> float:
        """Calculates rate for a single metric key."""
        try:
            previous = cache.get(key)
            rate = 0.0

            if previous:
                time_diff_seconds = current_timestamp_sec - previous["timestamp"]
                
                # Check for valid time difference
                if time_diff_seconds < 0:
                    logger.warning(f"Negative time difference for {key}: {time_diff_seconds}s - possible clock skew")
                    rate = 0.0
                elif time_diff_seconds >= self.min_time_diff_seconds:
                    value_diff = current_value - previous["value"]
                    
                    if value_diff >= 0:
                        rate = value_diff / time_diff_seconds
                        logger.debug(f"Calculated rate for {key}: {rate:.2f} (diff: {value_diff}, time: {time_diff_seconds}s)")
                    else:
                        # Counter reset detected
                        logger.info(f"Counter reset detected for {key}: {current_value} < {previous['value']}")
                        rate = 0.0
                else:
                    logger.debug(f"Time interval too short for {key}: {time_diff_seconds}s < {self.min_time_diff_seconds}s")
                    rate = 0.0
            else:
                logger.debug(f"No previous value for {key}, rate = 0.0")

            # Update cache with current values for the next calculation
            cache[key] = {
                "timestamp": current_timestamp_sec, 
                "value": current_value
            }
            
            return max(0.0, rate)
            
        except Exception as e:
            logger.error(f"Error calculating rate for {key}: {e}")
            return 0.0

    def calculate_netstat_rates(self, data: dict) -> dict:
        """Calculates all rates for a given netstat data dictionary."""
        rates = {
            "ipkts_rate": 0.0,
            "opkts_rate": 0.0,
            "ierrs_rate": 0.0,
            "oerrs_rate": 0.0,
        }
        
        try:
            current_timestamp_sec = self._parse_timestamp(data.get("timestamp", ""))
            if current_timestamp_sec is None:
                logger.warning("Cannot calculate netstat rates: invalid timestamp")
                return rates
                
            interface = data.get("interface", "default")
            if not interface:
                interface = "default"
                logger.warning("No interface specified, using 'default'")
            
            # Safe conversion of values
            ipkts = self._safe_float_conversion(data.get("ipkts", 0))
            opkts = self._safe_float_conversion(data.get("opkts", 0))
            ierrs = self._safe_float_conversion(data.get("ierrs", 0))
            oerrs = self._safe_float_conversion(data.get("oerrs", 0))

            rates["ipkts_rate"] = self._calculate_single_rate(
                self._previous_netstat_values,
                f"{interface}_ipkts",
                current_timestamp_sec,
                ipkts
            )
            rates["opkts_rate"] = self._calculate_single_rate(
                self._previous_netstat_values,
                f"{interface}_opkts",
                current_timestamp_sec,
                opkts
            )
            rates["ierrs_rate"] = self._calculate_single_rate(
                self._previous_netstat_values,
                f"{interface}_ierrs",
                current_timestamp_sec,
                ierrs
            )
            rates["oerrs_rate"] = self._calculate_single_rate(
                self._previous_netstat_values,
                f"{interface}_oerrs",
                current_timestamp_sec,
                oerrs
            )
            
            logger.debug(f"Calculated netstat rates for {interface}: {rates}")
            
        except Exception as e:
            logger.error(f"Error calculating netstat rates: {e}")
            
        return rates

    def calculate_iostat_rates(self, data: dict) -> dict:
        """Calculates all rates for a given iostat data dictionary."""
        rates = {
            "kb_read_rate": 0.0,
            "kb_wrtn_rate": 0.0,
        }
        
        try:
            current_timestamp_sec = self._parse_timestamp(data.get("timestamp", ""))
            if current_timestamp_sec is None:
                logger.warning("Cannot calculate iostat rates: invalid timestamp")
                return rates
                
            disk = data.get("disk", "unknown")
            if not disk:
                disk = "unknown"
                logger.warning("No disk specified, using 'unknown'")
            
            # Safe conversion of values
            kb_read = self._safe_float_conversion(data.get("kb_read", 0))
            kb_wrtn = self._safe_float_conversion(data.get("kb_wrtn", 0))

            rates["kb_read_rate"] = self._calculate_single_rate(
                self._previous_iostat_values,
                f"{disk}_kb_read",
                current_timestamp_sec,
                kb_read
            )
            rates["kb_wrtn_rate"] = self._calculate_single_rate(
                self._previous_iostat_values,
                f"{disk}_kb_wrtn",
                current_timestamp_sec,
                kb_wrtn
            )
            
            logger.debug(f"Calculated iostat rates for {disk}: {rates}")
            
        except Exception as e:
            logger.error(f"Error calculating iostat rates: {e}")
            
        return rates

    def get_cache_stats(self) -> dict:
        """Returns statistics about the internal caches."""
        return {
            "netstat_cache_size": len(self._previous_netstat_values),
            "iostat_cache_size": len(self._previous_iostat_values),
            "netstat_interfaces": list(set([key.split('_')[0] for key in self._previous_netstat_values.keys()])),
            "iostat_disks": list(set([key.split('_')[0] for key in self._previous_iostat_values.keys()]))
        }

    def clear_cache(self):
        """Clears all cached values."""
        self._previous_netstat_values.clear()
        self._previous_iostat_values.clear()
        logger.info("Rate calculator cache cleared")

    def clear_old_entries(self, max_age_seconds: int = 3600):
        """Removes cache entries older than max_age_seconds."""
        current_time = time.time()
        
        # Clean netstat cache
        old_keys = []
        for key, value in self._previous_netstat_values.items():
            if current_time - value["timestamp"] > max_age_seconds:
                old_keys.append(key)
        
        for key in old_keys:
            del self._previous_netstat_values[key]
        
        # Clean iostat cache  
        old_keys = []
        for key, value in self._previous_iostat_values.items():
            if current_time - value["timestamp"] > max_age_seconds:
                old_keys.append(key)
                
        for key in old_keys:
            del self._previous_iostat_values[key]
            
        if old_keys:
            logger.info(f"Cleaned {len(old_keys)} old entries from rate calculator cache")
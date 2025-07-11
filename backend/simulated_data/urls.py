# urls.py

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'servers', views.AIXServerViewSet)
router.register(r'collections', views.ServerMetricCollectionViewSet)
router.register(r'vmstat', views.VmstatMetricViewSet)
router.register(r'iostat', views.IostatMetricViewSet)
router.register(r'netstat', views.NetstatMetricViewSet)
router.register(r'processes', views.ProcessMetricViewSet)
router.register(r'simulation', views.SimulationManagementViewSet, basename='simulation')

urlpatterns = [
    path('api/', include(router.urls)),
]
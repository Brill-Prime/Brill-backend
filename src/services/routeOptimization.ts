
import GeolocationService from './geolocation';

interface DeliveryPoint {
  id: number;
  orderId: number;
  address: string;
  latitude: number;
  longitude: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  timeWindow?: {
    start: string;
    end: string;
  };
  estimatedDuration: number; // minutes
  type: 'PICKUP' | 'DELIVERY';
}

interface OptimizedRoute {
  points: DeliveryPoint[];
  totalDistance: number;
  totalDuration: number;
  estimatedFuelCost: number;
  routeEfficiency: number;
  warnings: string[];
}

interface RouteConstraints {
  maxDistance: number;
  maxDuration: number;
  vehicleType: string;
  fuelEfficiency: number; // km per liter
  fuelPrice: number; // price per liter
  workingHours: {
    start: string;
    end: string;
  };
}

class RouteOptimizationService {
  private static readonly TRAFFIC_MULTIPLIER = 1.3; // Account for traffic
  private static readonly SAFETY_BUFFER = 0.15; // 15% time buffer

  static async optimizeDeliveryRoute(
    driverLocation: { latitude: number; longitude: number },
    deliveryPoints: DeliveryPoint[],
    constraints: RouteConstraints
  ): Promise<OptimizedRoute> {
    try {
      if (deliveryPoints.length === 0) {
        throw new Error('No delivery points provided');
      }

      // Sort points by priority and time windows
      const sortedPoints = this.prioritizePoints(deliveryPoints);
      
      // Apply nearest neighbor with time window constraints
      const optimizedPoints = await this.nearestNeighborWithConstraints(
        driverLocation,
        sortedPoints,
        constraints
      );

      // Calculate total metrics
      const metrics = await this.calculateRouteMetrics(
        driverLocation,
        optimizedPoints,
        constraints
      );

      // Generate warnings
      const warnings = this.generateWarnings(optimizedPoints, metrics, constraints);

      return {
        points: optimizedPoints,
        totalDistance: metrics.totalDistance,
        totalDuration: metrics.totalDuration,
        estimatedFuelCost: metrics.fuelCost,
        routeEfficiency: metrics.efficiency,
        warnings
      };
    } catch (error) {
      console.error('Route optimization error:', error);
      throw error;
    }
  }

  private static prioritizePoints(points: DeliveryPoint[]): DeliveryPoint[] {
    return points.sort((a, b) => {
      // First sort by type (PICKUP before DELIVERY)
      if (a.type !== b.type) {
        return a.type === 'PICKUP' ? -1 : 1;
      }

      // Then by priority
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (a.priority !== b.priority) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }

      // Finally by time window start time
      if (a.timeWindow && b.timeWindow) {
        return a.timeWindow.start.localeCompare(b.timeWindow.start);
      }

      return 0;
    });
  }

  private static async nearestNeighborWithConstraints(
    start: { latitude: number; longitude: number },
    points: DeliveryPoint[],
    constraints: RouteConstraints
  ): Promise<DeliveryPoint[]> {
    const route: DeliveryPoint[] = [];
    const remaining = [...points];
    let currentLocation = start;
    let totalTime = 0;

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = Infinity;

      // Find the best next point considering distance, time windows, and priorities
      for (let i = 0; i < remaining.length; i++) {
        const point = remaining[i];
        
        // Calculate distance
        const distance = GeolocationService.haversineDistance(
          currentLocation,
          { latitude: point.latitude, longitude: point.longitude }
        );

        // Calculate travel time (with traffic multiplier)
        const travelTime = (distance / 40) * 60 * this.TRAFFIC_MULTIPLIER; // Assuming 40 km/h average speed
        
        // Check time window constraints
        const arrivalTime = totalTime + travelTime;
        let timeWindowPenalty = 0;
        
        if (point.timeWindow) {
          const windowStart = this.timeStringToMinutes(point.timeWindow.start);
          const windowEnd = this.timeStringToMinutes(point.timeWindow.end);
          
          if (arrivalTime < windowStart) {
            timeWindowPenalty = (windowStart - arrivalTime) * 0.5; // Waiting penalty
          } else if (arrivalTime > windowEnd) {
            timeWindowPenalty = (arrivalTime - windowEnd) * 2; // Late penalty
          }
        }

        // Calculate priority bonus
        const priorityBonus = point.priority === 'HIGH' ? -10 : 
                             point.priority === 'MEDIUM' ? 0 : 5;

        // Calculate composite score
        const score = distance + timeWindowPenalty + priorityBonus;

        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      // Add best point to route
      const selectedPoint = remaining.splice(bestIndex, 1)[0];
      route.push(selectedPoint);

      // Update current location and time
      currentLocation = {
        latitude: selectedPoint.latitude,
        longitude: selectedPoint.longitude
      };

      const travelTime = GeolocationService.haversineDistance(
        currentLocation,
        { latitude: selectedPoint.latitude, longitude: selectedPoint.longitude }
      ) / 40 * 60 * this.TRAFFIC_MULTIPLIER;

      totalTime += travelTime + selectedPoint.estimatedDuration;

      // Check if we're exceeding constraints
      if (totalTime > constraints.maxDuration) {
        break; // Stop adding more points
      }
    }

    return route;
  }

  private static async calculateRouteMetrics(
    start: { latitude: number; longitude: number },
    points: DeliveryPoint[],
    constraints: RouteConstraints
  ): Promise<{
    totalDistance: number;
    totalDuration: number;
    fuelCost: number;
    efficiency: number;
  }> {
    let totalDistance = 0;
    let totalDuration = 0;
    let currentLocation = start;

    // Calculate for each leg of the journey
    for (const point of points) {
      const distance = GeolocationService.haversineDistance(
        currentLocation,
        { latitude: point.latitude, longitude: point.longitude }
      );

      const travelTime = (distance / 40) * 60 * this.TRAFFIC_MULTIPLIER;
      
      totalDistance += distance;
      totalDuration += travelTime + point.estimatedDuration;
      
      currentLocation = {
        latitude: point.latitude,
        longitude: point.longitude
      };
    }

    // Add safety buffer
    totalDuration *= (1 + this.SAFETY_BUFFER);

    // Calculate fuel cost
    const fuelNeeded = totalDistance / constraints.fuelEfficiency;
    const fuelCost = fuelNeeded * constraints.fuelPrice;

    // Calculate efficiency (deliveries per km)
    const deliveryPoints = points.filter(p => p.type === 'DELIVERY').length;
    const efficiency = deliveryPoints / Math.max(totalDistance, 1);

    return {
      totalDistance,
      totalDuration,
      fuelCost,
      efficiency
    };
  }

  private static generateWarnings(
    points: DeliveryPoint[],
    metrics: any,
    constraints: RouteConstraints
  ): string[] {
    const warnings: string[] = [];

    if (metrics.totalDuration > constraints.maxDuration) {
      warnings.push(`Route duration (${Math.round(metrics.totalDuration)} min) exceeds maximum allowed (${constraints.maxDuration} min)`);
    }

    if (metrics.totalDistance > constraints.maxDistance) {
      warnings.push(`Route distance (${Math.round(metrics.totalDistance)} km) exceeds maximum allowed (${constraints.maxDistance} km)`);
    }

    // Check for tight time windows
    const tightWindows = points.filter(p => {
      if (!p.timeWindow) return false;
      const start = this.timeStringToMinutes(p.timeWindow.start);
      const end = this.timeStringToMinutes(p.timeWindow.end);
      return (end - start) < 60; // Less than 1 hour window
    });

    if (tightWindows.length > 0) {
      warnings.push(`${tightWindows.length} delivery(s) have tight time windows (< 1 hour)`);
    }

    // Check for high fuel cost
    if (metrics.fuelCost > 5000) { // Assuming NGN currency
      warnings.push(`High fuel cost estimated: ₦${Math.round(metrics.fuelCost)}`);
    }

    return warnings;
  }

  private static timeStringToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Real-time route adjustment based on traffic
  static async adjustRouteForTraffic(
    currentRoute: DeliveryPoint[],
    currentLocation: { latitude: number; longitude: number },
    trafficData?: any
  ): Promise<DeliveryPoint[]> {
    // In a real implementation, this would integrate with traffic APIs
    // For now, we'll implement a simple reordering based on current location
    
    const remaining = currentRoute.filter(point => 
      // Only include points that haven't been completed
      !point.type || point.type === 'DELIVERY'
    );

    if (remaining.length <= 1) return currentRoute;

    // Find the nearest unvisited point
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const distance = GeolocationService.haversineDistance(
        currentLocation,
        { latitude: remaining[i].latitude, longitude: remaining[i].longitude }
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    // Move the nearest point to the front
    const adjusted = [...remaining];
    const nearest = adjusted.splice(nearestIndex, 1)[0];
    adjusted.unshift(nearest);

    return adjusted;
  }

  // Calculate ETA for specific delivery
  static async calculateDeliveryETA(
    currentLocation: { latitude: number; longitude: number },
    deliveryPoint: DeliveryPoint,
    routePoints: DeliveryPoint[]
  ): Promise<{
    eta: Date;
    estimatedTravelTime: number;
    confidence: number;
  }> {
    // Find position of delivery point in route
    const pointIndex = routePoints.findIndex(p => p.id === deliveryPoint.id);
    
    if (pointIndex === -1) {
      throw new Error('Delivery point not found in route');
    }

    let totalTime = 0;
    let currentPos = currentLocation;

    // Calculate time to reach this point
    for (let i = 0; i <= pointIndex; i++) {
      const point = routePoints[i];
      const distance = GeolocationService.haversineDistance(
        currentPos,
        { latitude: point.latitude, longitude: point.longitude }
      );

      const travelTime = (distance / 35) * 60 * this.TRAFFIC_MULTIPLIER; // 35 km/h in city
      totalTime += travelTime;

      if (i < pointIndex) {
        totalTime += point.estimatedDuration; // Add service time for intermediate stops
        currentPos = { latitude: point.latitude, longitude: point.longitude };
      }
    }

    // Calculate ETA
    const eta = new Date(Date.now() + totalTime * 60 * 1000);

    // Calculate confidence based on various factors
    let confidence = 0.8; // Base confidence
    
    // Reduce confidence for longer routes
    if (totalTime > 120) confidence -= 0.1;
    if (pointIndex > 5) confidence -= 0.1;
    
    // Increase confidence for short routes
    if (totalTime < 30) confidence += 0.1;
    
    confidence = Math.max(0.5, Math.min(0.95, confidence));

    return {
      eta,
      estimatedTravelTime: totalTime,
      confidence
    };
  }
}

export default RouteOptimizationService;


import axios from 'axios';

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface AddressValidationResult {
  isValid: boolean;
  formattedAddress?: string;
  coordinates?: Coordinates;
  components?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
}

interface DistanceResult {
  distance: number; // in kilometers
  duration: number; // in minutes
  route?: Coordinates[];
}

interface RouteOptimizationResult {
  optimizedRoute: Coordinates[];
  totalDistance: number;
  totalDuration: number;
  waypoints: number[];
}

class GeolocationService {
  private static readonly GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  private static readonly HERE_API_KEY = process.env.HERE_API_KEY;

  // Address validation using Google Geocoding API
  static async validateAddress(address: string): Promise<AddressValidationResult> {
    try {
      if (!this.GOOGLE_MAPS_API_KEY) {
        console.warn('Google Maps API key not configured');
        return { isValid: false };
      }

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/geocode/json`,
        {
          params: {
            address,
            key: this.GOOGLE_MAPS_API_KEY
          }
        }
      );

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];
        const location = result.geometry.location;
        
        // Extract address components
        const components: any = {};
        result.address_components.forEach((component: any) => {
          const types = component.types;
          if (types.includes('street_number') || types.includes('route')) {
            components.street = (components.street || '') + ' ' + component.long_name;
          } else if (types.includes('locality')) {
            components.city = component.long_name;
          } else if (types.includes('administrative_area_level_1')) {
            components.state = component.long_name;
          } else if (types.includes('country')) {
            components.country = component.long_name;
          } else if (types.includes('postal_code')) {
            components.postalCode = component.long_name;
          }
        });

        return {
          isValid: true,
          formattedAddress: result.formatted_address,
          coordinates: {
            latitude: location.lat,
            longitude: location.lng
          },
          components: components
        };
      }

      return { isValid: false };
    } catch (error) {
      console.error('Address validation error:', error);
      return { isValid: false };
    }
  }

  // Reverse geocoding - get address from coordinates
  static async getAddressFromCoordinates(lat: number, lng: number): Promise<string | null> {
    try {
      if (!this.GOOGLE_MAPS_API_KEY) {
        console.warn('Google Maps API key not configured');
        return null;
      }

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/geocode/json`,
        {
          params: {
            latlng: `${lat},${lng}`,
            key: this.GOOGLE_MAPS_API_KEY
          }
        }
      );

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        return response.data.results[0].formatted_address;
      }

      return null;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  }

  // Calculate distance and duration between two points
  static async calculateDistance(
    origin: Coordinates,
    destination: Coordinates,
    mode: 'driving' | 'walking' | 'transit' = 'driving'
  ): Promise<DistanceResult | null> {
    try {
      if (!this.GOOGLE_MAPS_API_KEY) {
        // Fallback to Haversine formula for distance only
        const distance = this.haversineDistance(origin, destination);
        return {
          distance,
          duration: distance * (mode === 'walking' ? 12 : 2) // rough estimate
        };
      }

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/distancematrix/json`,
        {
          params: {
            origins: `${origin.latitude},${origin.longitude}`,
            destinations: `${destination.latitude},${destination.longitude}`,
            mode,
            units: 'metric',
            key: this.GOOGLE_MAPS_API_KEY
          }
        }
      );

      if (response.data.status === 'OK' && 
          response.data.rows[0].elements[0].status === 'OK') {
        const element = response.data.rows[0].elements[0];
        return {
          distance: element.distance.value / 1000, // Convert to kilometers
          duration: element.duration.value / 60     // Convert to minutes
        };
      }

      return null;
    } catch (error) {
      console.error('Distance calculation error:', error);
      return null;
    }
  }

  // Haversine formula for distance calculation (fallback)
  static haversineDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(coord2.latitude - coord1.latitude);
    const dLon = this.toRadians(coord2.longitude - coord1.longitude);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(coord1.latitude)) *
              Math.cos(this.toRadians(coord2.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private static toRadians(degree: number): number {
    return degree * (Math.PI / 180);
  }

  // Route optimization for multiple waypoints
  static async optimizeRoute(
    start: Coordinates,
    end: Coordinates,
    waypoints: Coordinates[]
  ): Promise<RouteOptimizationResult | null> {
    try {
      if (!this.GOOGLE_MAPS_API_KEY) {
        // Simple optimization using nearest neighbor algorithm
        return this.nearestNeighborOptimization(start, end, waypoints);
      }

      const waypointStr = waypoints
        .map(wp => `${wp.latitude},${wp.longitude}`)
        .join('|');

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/directions/json`,
        {
          params: {
            origin: `${start.latitude},${start.longitude}`,
            destination: `${end.latitude},${end.longitude}`,
            waypoints: `optimize:true|${waypointStr}`,
            key: this.GOOGLE_MAPS_API_KEY
          }
        }
      );

      if (response.data.status === 'OK' && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        const leg = route.legs[0];
        
        return {
          optimizedRoute: [start, ...waypoints, end],
          totalDistance: leg.distance.value / 1000,
          totalDuration: leg.duration.value / 60,
          waypoints: route.waypoint_order || []
        };
      }

      return null;
    } catch (error) {
      console.error('Route optimization error:', error);
      return null;
    }
  }

  // Simple nearest neighbor optimization (fallback)
  private static nearestNeighborOptimization(
    start: Coordinates,
    end: Coordinates,
    waypoints: Coordinates[]
  ): RouteOptimizationResult {
    const route = [start];
    const remaining = [...waypoints];
    let current = start;
    let totalDistance = 0;

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = this.haversineDistance(current, remaining[0]);

      for (let i = 1; i < remaining.length; i++) {
        const distance = this.haversineDistance(current, remaining[i]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }

      const nearest = remaining.splice(nearestIndex, 1)[0];
      route.push(nearest);
      totalDistance += nearestDistance;
      current = nearest;
    }

    route.push(end);
    totalDistance += this.haversineDistance(current, end);

    return {
      optimizedRoute: route,
      totalDistance,
      totalDuration: totalDistance * 2, // Rough estimate
      waypoints: Array.from({ length: waypoints.length }, (_, i) => i)
    };
  }

  // Get nearby places (using Google Places API)
  static async getNearbyPlaces(
    location: Coordinates,
    radius: number = 5000,
    type: string = 'restaurant'
  ): Promise<any[]> {
    try {
      if (!this.GOOGLE_MAPS_API_KEY) {
        console.warn('Google Maps API key not configured');
        return [];
      }

      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json`,
        {
          params: {
            location: `${location.latitude},${location.longitude}`,
            radius,
            type,
            key: this.GOOGLE_MAPS_API_KEY
          }
        }
      );

      if (response.data.status === 'OK') {
        return response.data.results;
      }

      return [];
    } catch (error) {
      console.error('Nearby places error:', error);
      return [];
    }
  }
}

export default GeolocationService;

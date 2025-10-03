
import { getDatabase, ref, set } from "firebase/database";
import app from "../config/firebase";

const db = getDatabase(app);

// This is a representation of your database schema in Firebase.
// You can use this as a reference for how your data is organized.
const schema = {
  users: {
    "user_id_1": {
      "email": "user@example.com",
      "fullName": "John Doe",
      "phone": "123-456-7890",
      "role": "CONSUMER",
      "isVerified": false,
      "createdAt": "2023-10-27T10:00:00Z"
    }
  },
  categories: {
    "category_id_1": {
      "name": "Electronics",
      "description": "Gadgets and devices",
      "imageUrl": "http://example.com/electronics.png",
      "isActive": true
    }
  },
  products: {
    "product_id_1": {
      "merchantId": "user_id_1",
      "sellerId": "user_id_2",
      "name": "Smartphone",
      "description": "Latest model smartphone",
      "price": 999.99,
      "categoryId": "category_id_1",
      "stockQuantity": 100,
      "isAvailable": true
    }
  },
  cartItems: {
    "cart_item_id_1": {
      "userId": "user_id_1",
      "productId": "product_id_1",
      "quantity": 2
    }
  },
  orders: {
    "order_id_1": {
      "orderNumber": "ORD-12345",
      "customerId": "user_id_1",
      "merchantId": "user_id_2",
      "driverId": "user_id_3",
      "status": "PENDING",
      "totalAmount": 1999.98,
      "deliveryAddress": "123 Main St, Anytown, USA"
    }
  },
  orderItems: {
    "order_item_id_1": {
      "orderId": "order_id_1",
      "productId": "product_id_1",
      "quantity": 2,
      "price": 999.99
    }
  },
  escrows: {
    "escrow_id_1": {
        "orderId": "order_id_1",
        "payerId": "user_id_1",
        "payeeId": "user_id_2",
        "amount": 1999.98,
        "status": "HELD"
    }
  },
  transactions: {
    "transaction_id_1": {
        "userId": "user_id_1",
        "orderId": "order_id_1",
        "amount": 1999.98,
        "type": "PAYMENT",
        "status": "PENDING"
    }
  },
  driverProfiles: {
    "driver_profile_id_1": {
        "userId": "user_id_3",
        "vehicleType": "Sedan",
        "isOnline": true,
        "isAvailable": true
    }
  },
  merchantProfiles: {
    "merchant_profile_id_1": {
        "userId": "user_id_2",
        "businessName": "Gadget Store",
        "businessAddress": "456 Market St, Anytown, USA",
        "isOpen": true
    }
  },
  fuelOrders: {
    "fuel_order_id_1": {
        "customerId": "user_id_4",
        "stationId": "station_id_1",
        "fuelType": "PMS",
        "quantity": 25.5,
        "totalAmount": 50.00,
        "status": "DELIVERED"
    }
  },
  ratings: {
    "rating_id_1": {
        "orderId": "order_id_1",
        "customerId": "user_id_1",
        "driverId": "user_id_3",
        "rating": 5,
        "comment": "Great service!"
    }
  },
  deliveryFeedback: {
    "feedback_id_1": {
        "orderId": "order_id_1",
        "customerId": "user_id_1",
        "driverId": "user_id_3",
        "driverRating": 5,
        "comment": "Excellent delivery experience."
    }
  },
  supportTickets: {
    "ticket_id_1": {
        "userId": "user_id_1",
        "title": "Issue with my order",
        "description": "I have not received my order yet.",
        "status": "OPEN"
    }
  },
  messages: {
    "message_id_1": {
        "senderId": "user_id_1",
        "receiverId": "user_id_2",
        "message": "Hi there!",
        "isRead": false
    }
  },
  notifications: {
    "notification_id_1": {
        "userId": "user_id_1",
        "title": "Order Confirmed",
        "message": "Your order ORD-12345 has been confirmed.",
        "isRead": false
    }
  }
};

/**
 * Writes data to the Firebase Realtime Database.
 *
 * @param path The path to the data.
 * @param data The data to write.
 */
export const writeData = (path: string, data: any) => {
    return set(ref(db, path), data);
};

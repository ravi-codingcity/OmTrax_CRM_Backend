# OmTrax CRM Backend

A robust Sales CRM Backend built with Node.js, Express.js, and MongoDB.

## 🚀 Features

- **Authentication System**: JWT-based signup/login with role-based access control
- **Sales Entry Management**: Complete CRUD operations for sales entries
- **Follow-Up Tracking**: Track and manage follow-ups with history
- **Notifications**: Real-time notification system for follow-ups and reminders
- **Dashboard & Analytics**: Comprehensive statistics and performance metrics
- **Branch Management**: Multi-branch support

## 📁 Project Structure

```
CRM_backend/
├── src/
│   ├── config/
│   │   ├── db.js              # MongoDB connection
│   │   └── constants.js       # App constants & configuration
│   ├── controllers/
│   │   ├── authController.js      # Authentication logic
│   │   ├── salesController.js     # Sales entry operations
│   │   ├── followUpController.js  # Follow-up operations
│   │   ├── notificationController.js
│   │   ├── dashboardController.js # Analytics & stats
│   │   └── branchController.js
│   ├── middleware/
│   │   ├── auth.js            # JWT authentication
│   │   ├── errorHandler.js    # Global error handling
│   │   ├── asyncHandler.js    # Async wrapper
│   │   └── validate.js        # Request validation
│   ├── models/
│   │   ├── User.js
│   │   ├── Branch.js
│   │   ├── SalesEntry.js
│   │   ├── FollowUp.js
│   │   ├── Notification.js
│   │   └── index.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── salesRoutes.js
│   │   ├── followUpRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── dashboardRoutes.js
│   │   ├── branchRoutes.js
│   │   └── index.js
│   ├── utils/
│   │   └── helpers.js         # Utility functions
│   ├── app.js                 # Express app setup
│   └── server.js              # Server entry point
├── .env.example               # Environment variables template
├── .gitignore
├── package.json
└── README.md
```

## 🛠️ Installation

### Prerequisites

- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

### Setup

1. **Clone the repository**
   ```bash
   cd CRM_backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/omtrax_crm
   JWT_SECRET=your_super_secret_jwt_key
   JWT_EXPIRE=7d
   CORS_ORIGIN=http://localhost:3000
   ```

4. **Start the server**
   ```bash
   # Development mode (with hot reload)
   npm run dev
   
   # Production mode
   npm start
   ```

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/auth/signup` | Register new user | Public |
| POST | `/auth/login` | User login | Public |
| GET | `/auth/me` | Get current user | Private |
| PUT | `/auth/update-password` | Update password | Private |
| GET | `/auth/users` | Get all users | Admin |
| PUT | `/auth/users/:id` | Update user | Admin |

### Sales Entry Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/sales` | Get all sales entries | Private |
| POST | `/sales` | Create sales entry | Private |
| GET | `/sales/:id` | Get single entry | Private |
| PUT | `/sales/:id` | Update entry | Private |
| DELETE | `/sales/:id` | Delete entry | Admin |
| GET | `/sales/follow-ups/today` | Today's follow-ups | Private |
| GET | `/sales/follow-ups/overdue` | Overdue follow-ups | Private |

### Follow-Up Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/follow-ups` | Add follow-up | Private |
| GET | `/follow-ups/my` | Get my follow-ups | Private |
| GET | `/follow-ups/sales/:id` | Get by sales entry | Private |
| GET | `/follow-ups/:id` | Get single follow-up | Private |
| PUT | `/follow-ups/:id` | Update follow-up | Private |
| DELETE | `/follow-ups/:id` | Delete follow-up | Admin |

### Notification Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/notifications` | Get notifications | Private |
| GET | `/notifications/unread-count` | Get unread count | Private |
| PUT | `/notifications/:id/read` | Mark as read | Private |
| PUT | `/notifications/read-all` | Mark all as read | Private |
| DELETE | `/notifications/clear-read` | Clear read notifications | Private |

### Dashboard Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/dashboard/stats` | Get statistics | Private |
| GET | `/dashboard/analytics` | Get analytics | Private |
| GET | `/dashboard/activities` | Recent activities | Private |
| GET | `/dashboard/salesperson-performance` | Performance metrics | Admin |

### Branch Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/branches` | Get all branches | Private |
| POST | `/branches` | Create branch | Admin |
| GET | `/branches/:id` | Get single branch | Private |
| PUT | `/branches/:id` | Update branch | Admin |
| DELETE | `/branches/:id` | Delete branch | Admin |

## 🔐 Authentication

Include JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## 📝 Request Examples

### Signup
```json
POST /api/auth/signup
{
  "username": "john_doe",
  "password": "password123",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "salesperson",
  "branch": "Main Office",
  "phoneNumber": "1234567890"
}
```

### Create Sales Entry
```json
POST /api/sales
{
  "companyName": "ABC Corp",
  "contactPerson": "Jane Smith",
  "contactNumber": "9876543210",
  "contactEmail": "jane@abc.com",
  "designation": "Manager",
  "requirement": "CRM Software",
  "location": "New York",
  "remark": "Initial inquiry",
  "nextFollowUpDate": "2026-02-10",
  "queryStatus": "new"
}
```

### Add Follow-Up
```json
POST /api/follow-ups
{
  "salesEntryId": "64abc123...",
  "remark": "Discussed pricing",
  "nextFollowUpDate": "2026-02-15",
  "contactMethod": "call",
  "outcome": "positive"
}
```

## 👥 User Roles

- **admin**: Full access to all features
- **manager**: Access to team data and reports
- **salesperson**: Access to own data only

## 🔧 Query Parameters

### Pagination
```
?page=1&limit=10
```

### Filtering
```
?queryStatus=new&branch=64abc123...&startDate=2026-01-01&endDate=2026-12-31
```

### Sorting
```
?sortBy=createdAt&sortOrder=desc
```

### Search
```
?search=company_name
```

## 🚦 Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error

## 📊 Query Status Values

- `new` - New entry
- `in_progress` - In progress
- `follow_up` - Requires follow-up
- `converted` - Successfully converted
- `closed` - Closed (general)
- `not_interested` - Not interested

## 🔔 Notification Types

- `followup` - Follow-up scheduled
- `reminder` - Follow-up reminder
- `new_entry` - New sales entry added

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

ISC License

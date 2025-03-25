require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json()); // Parse JSON request bodies

// **🔹 Use Render's Assigned Port**
const PORT = process.env.PORT || 10000; // ✅ Render assigns PORT dynamically

// **🔹 Database Connection (Aiven MySQL)**
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }, // ✅ Fix SSL issue
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
    process.exit(1); // Stop the app if DB connection fails
  } else {
    console.log("✅ Connected to Aiven MySQL Database");
  }
});

// **🔹 Create a Virtual Account using Paystack API**
async function createVirtualAccount(email, firstName, lastName, phone) {
  try {
    const response = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        preferred_bank: "wema-bank",
        country: "NG",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.status) {
      return response.data.data.account_number; // Return real account number
    } else {
      throw new Error("Failed to create Paystack virtual account");
    }
  } catch (error) {
    console.error("❌ Error creating Paystack account:", error.response?.data || error.message);
    return null;
  }
}

// **🔹 Save Financial Data (with Real Virtual Account Number)**
app.post("/saveFinancialData", async (req, res) => {
  const { email, bvn, phoneNumber, firstName, lastName } = req.body;

  if (!email || !bvn || !phoneNumber || !firstName || !lastName) {
    return res.status(400).json({ status: "error", message: "All fields are required" });
  }

  const realAccountNumber = await createVirtualAccount(email, firstName, lastName, phoneNumber);

  if (!realAccountNumber) {
    return res.status(500).json({ status: "error", message: "Failed to create virtual account" });
  }

  const query = `
    INSERT INTO users (email, bvn, account_number, phone_number, balance, currency) 
    VALUES (?, ?, ?, ?, 0, 'NGN')
  `;

  db.query(query, [email, bvn, realAccountNumber, phoneNumber], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ status: "error", message: "Database error", error: err });
    }
    res.json({ status: "success", message: "Financial data saved", account_number: realAccountNumber });
  });
});

// **🔹 Get User Financial Data**
app.get("/getFinancialData", (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ status: "error", message: "Email is required" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ status: "error", message: "Database error" });
    }
    if (result.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }
    res.json(result[0]);
  });
});

// **🔹 Deposit Funds**
app.post("/deposit", (req, res) => {
  const { email, amount } = req.body;

  if (!email || !amount || amount <= 0) {
    return res.status(400).json({ status: "error", message: "Valid email and amount are required" });
  }

  db.query("UPDATE users SET balance = balance + ? WHERE email = ?", [amount, email], (err, result) => {
    if (err) {
      console.error("❌ Deposit error:", err);
      return res.status(500).json({ status: "error", message: "Deposit failed" });
    }
    res.json({ status: "success", message: "Deposit successful" });
  });
});

// **🔹 Withdraw Funds**
app.post("/withdraw", (req, res) => {
  const { email, amount } = req.body;

  if (!email || !amount || amount <= 0) {
    return res.status(400).json({ status: "error", message: "Valid email and amount are required" });
  }

  db.query("SELECT balance FROM users WHERE email = ?", [email], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ status: "error", message: "Database error" });
    }
    if (result.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const currentBalance = result[0].balance;
    if (currentBalance < amount) {
      return res.status(400).json({ status: "error", message: "Insufficient funds" });
    }

    db.query("UPDATE users SET balance = balance - ? WHERE email = ?", [amount, email], (err, updateResult) => {
      if (err) {
        console.error("❌ Withdrawal error:", err);
        return res.status(500).json({ status: "error", message: "Withdrawal failed" });
      }
      res.json({ status: "success", message: "Withdrawal successful" });
    });
  });
});

// **🔹 Root Route to Confirm Server is Running**
app.get("/", (req, res) => {
  res.send("🚀 Server is running on Render!");
});

// **🔹 Start Server (Correct Port for Render)**
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
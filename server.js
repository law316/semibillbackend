require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json()); // Parse JSON request bodies

// Database connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
  } else {
    console.log("Connected to MySQL Database");
  }
});

// **🔹 Create a Virtual Account using Paystack API**
async function createVirtualAccount(email, firstName, lastName, phone) {
  try {
    const response = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        email: email,
        first_name: firstName,
        last_name: lastName,
        phone: phone,
        preferred_bank: "wema-bank", // You can change this to "titan-paystack"
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
      return response.data.data.account_number; // Return the real account number
    } else {
      throw new Error("Failed to create Paystack virtual account");
    }
  } catch (error) {
    console.error("Error creating Paystack account:", error.response?.data || error.message);
    return null;
  }
}

// **🔹 Save Financial Data (with Real Virtual Account Number)**
app.post("/saveFinancialData", async (req, res) => {
  const { email, bvn, phoneNumber, firstName, lastName } = req.body;

  // Request a real virtual account from Paystack
  const realAccountNumber = await createVirtualAccount(email, firstName, lastName, phoneNumber);

  if (!realAccountNumber) {
    return res.status(500).json({ status: "error", message: "Failed to create virtual account" });
  }

  const query = `
    INSERT INTO users_financial_data (email, bvn, account_number, phone_number, balance) 
    VALUES (?, ?, ?, ?, 0)
  `;

  db.query(query, [email, bvn, realAccountNumber, phoneNumber], (err, result) => {
    if (err) {
      return res.status(500).json({ status: "error", message: "Database error", error: err });
    }
    res.json({ status: "success", message: "Financial data saved", account_number: realAccountNumber });
  });
});

// **🔹 Get User Financial Data**
app.get("/getFinancialData", (req, res) => {
  const { email } = req.query;

  db.query("SELECT * FROM users_financial_data WHERE email = ?", [email], (err, result) => {
    if (err || result.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }
    res.json(result[0]);
  });
});

// **🔹 Deposit Funds**
app.post("/deposit", (req, res) => {
  const { email, amount } = req.body;

  const query = "UPDATE users_financial_data SET balance = balance + ? WHERE email = ?";
  db.query(query, [amount, email], (err, result) => {
    if (err) {
      return res.status(500).json({ status: "error", message: "Deposit failed" });
    }
    res.json({ status: "success", message: "Deposit successful" });
  });
});

// **🔹 Withdraw Funds**
app.post("/withdraw", (req, res) => {
  const { email, amount } = req.body;

  db.query("SELECT balance FROM users_financial_data WHERE email = ?", [email], (err, result) => {
    if (err || result.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const currentBalance = result[0].balance;
    if (currentBalance < amount) {
      return res.status(400).json({ status: "error", message: "Insufficient funds" });
    }

    db.query("UPDATE users_financial_data SET balance = balance - ? WHERE email = ?", [amount, email], (err, updateResult) => {
      if (err) {
        return res.status(500).json({ status: "error", message: "Withdrawal failed" });
      }
      res.json({ status: "success", message: "Withdrawal successful" });
    });
  });
});

// **🔹 Start Server**
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
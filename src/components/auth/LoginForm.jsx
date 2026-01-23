import React, { useState } from "react";
import { Link } from "react-router-dom";
import "./LoginForm.css";

const LoginForm = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [error, setError] = useState("");

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.id]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const response = await fetch("http://127.0.0.1:8000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });
      const data = await response.json();

      if (response.ok) {
        alert(`Welcome back, ${data.name}! You have successfully logged in.`);
        setFormData({ email: "", password: "" });
      } else {
        setError(data.message || "Login failed. Please try again.");
      }
    } catch (error) {
      setError("An error occurred. Please try again later.");
    }
  };

  return (
    <div className="form-container">
      <form onSubmit={handleSubmit}>
        <h2>Log in to VoiceBridge</h2>
        <label htmlFor="email">Email:</label>
        <input
          type="email"
          id="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="email@example.com"
          required
        />
        <label htmlFor="password">Password:</label>
        <input
          type="password"
          id="password"
          value={formData.password}
          onChange={handleChange}
          placeholder="Min 8 characters"
          required
        />
        <button type="submit" className="signup-button">
          Log in
        </button>
        {error && <p style={{ color: "red", fontWeight: "bold" }}>{error}</p>}
        <p>
          New to VoiceBridge?{" "}
          <Link to="/signup" className="auth-link">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
};

export default LoginForm;

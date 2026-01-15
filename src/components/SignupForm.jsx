import React, { useState } from "react";

const SignupForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.id]: e.target.value,
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    alert(`Welcome to VoiceBridge, ${formData.name}!`);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Join VoiceBridge</h2>
      <label htmlFor="name">Full Name:</label>
      <input
        type="text"
        id="name"
        value={formData.name}
        onChange={handleChange}
        placeholder="Enter your name"
        required
      />
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
      <button type="submit">Sign Up</button>
    </form>
  );
};

export default SignupForm;

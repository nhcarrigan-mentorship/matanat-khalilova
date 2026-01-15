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
    console.log("Form submitted!", formData);
    alert(`Welcome to VoiceBridge, ${formData.name}!`);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Join VoiceBridge</h2>
      <label htmlFor="name">Full Name:</label>
      <input type="text" id="name" placeholder="Enter your name" required />
      <label htmlFor="email">Email:</label>
      <input type="email" id="email" placeholder="email@example.com" required />
      <label htmlFor="password">Password:</label>
      <input
        type="password"
        id="password"
        placeholder="Min 8 characters"
        required
      />
      <button type="submit">Sign Up</button>
    </form>
  );
};

export default SignupForm;

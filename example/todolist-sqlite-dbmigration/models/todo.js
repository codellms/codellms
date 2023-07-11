const Sequelize = require('sequelize');
const db = require('../db');

const Todo = db.define('todo', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task: {
    type: Sequelize.STRING,
    allowNull: false,
  },
});

module.exports = Todo;
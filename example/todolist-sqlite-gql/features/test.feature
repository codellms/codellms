Feature: TodoList API project.Use SQLite as the database.
Scenario: Add a new todo item.
Given: An input parameter that is a string of "todo" for the todo item.
Then: Record the todo item and random id to sqlite. 
Scenario: Return the todolist.
Then: Return the newly added todolist from sqlite.
Scenario: Return the todoitem.
When: Provide a todo id.
Then: Return todo item.

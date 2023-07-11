Feature: TodoList API project.
Scenario: Add a new todo item.
Given: An input parameter that is a string of "todo" for the todo item.
Then: Record the todo item and random id to db. 
Scenario: Return the todolist.
Then: Return the newly added todolist from db.
Scenario: Return the todoitem.
When: Provide a todo id.
Then: Return todo item.

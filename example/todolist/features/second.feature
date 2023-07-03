Feature: TodoList API project using RESTful style, utilizing "todos" as the endpoint and not utilizing any database.
Scenario: Delete a new todo item.
Given: Enter the ID of a specific todo item.
When: delete
Then: Delete the todo item corresponding to that ID.
Scenario: Return the todo item.
Given: id
When: get
Then: Return the todo item.

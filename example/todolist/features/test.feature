Feature: TodoList API project using RESTful style, utilizing "todos" as the endpoint and not utilizing any database.
Scenario: Add a new todo item.
Given: An input parameter that is a string of "todo" for the todo item.
When: post
Then: Record the todo item in memory so that the entire todolist can be returned to the frontend.
Scenario: Return the todolist.
When: get
Then: Return the newly added todolist.

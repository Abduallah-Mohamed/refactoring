# refactoring

### I supposed that you are using the native mongodb drive not using any ODM packages like mongoose. so instead of create method I used insertOne.

### I established a description to function

### refactor the code by:

##### Adding some comments on the lines that are not detailed well.

##### Adding some base conditions. (if the collection is empty throw an error and quite the whole function).

##### const --> variable decleration which cause an error on the loop.

##### I found that you are using a wait in a place that won't has any effect so i deleted it.

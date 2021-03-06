/**
 * @fileoverview Rule to flag use of variables before they are defined
 * @copyright ESLint
 * @see https://github.com/eslint/eslint/blob/a113cd3/lib/rules/no-use-before-define.js
 * @author Ilya Volodin
 * @author Jed Fox
 */

"use strict";

const util = require("../util");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const SENTINEL_TYPE = /^(?:(?:Function|Class)(?:Declaration|Expression)|ArrowFunctionExpression|CatchClause|ImportDeclaration|ExportNamedDeclaration)$/;
const FOR_IN_OF_TYPE = /^For(?:In|Of)Statement$/;

/**
 * Parses a given value as options.
 *
 * @param {any} options - A value to parse.
 * @returns {Object} The parsed options.
 */
function parseOptions(options) {
    let functions = true;
    let classes = true;
    let variables = true;
    let typedefs = true;

    if (typeof options === "string") {
        functions = options !== "nofunc";
    } else if (typeof options === "object" && options !== null) {
        functions = options.functions !== false;
        classes = options.classes !== false;
        variables = options.variables !== false;
        typedefs = options.typedefs !== false;
    }

    return { functions, classes, variables, typedefs };
}

/**
 * @param {Scope} scope - a scope to check
 * @returns {boolean} `true` if the scope is toplevel
 */
function isTopLevelScope(scope) {
    return scope.type === "module" || scope.type === "global";
}

/**
 * Checks whether or not a given variable is a function declaration.
 *
 * @param {eslint-scope.Variable} variable - A variable to check.
 * @returns {boolean} `true` if the variable is a function declaration.
 */
function isFunction(variable) {
    return variable.defs[0].type === "FunctionName";
}

/**
 * Checks whether or not a given variable is a class declaration in an upper function scope.
 *
 * @param {eslint-scope.Variable} variable - A variable to check.
 * @param {eslint-scope.Reference} reference - A reference to check.
 * @returns {boolean} `true` if the variable is a class declaration.
 */
function isOuterClass(variable, reference) {
    if (variable.defs[0].type !== "ClassName") {
        return false;
    }

    if (variable.scope.variableScope === reference.from.variableScope) {
        // allow the same scope only if it's the top level global/module scope
        if (!isTopLevelScope(variable.scope.variableScope)) {
            return false;
        }
    }

    return true;
}

/**
 * Checks whether or not a given variable is a variable declaration in an upper function scope.
 * @param {eslint-scope.Variable} variable - A variable to check.
 * @param {eslint-scope.Reference} reference - A reference to check.
 * @returns {boolean} `true` if the variable is a variable declaration.
 */
function isOuterVariable(variable, reference) {
    if (variable.defs[0].type !== "Variable") {
        return false;
    }

    if (variable.scope.variableScope === reference.from.variableScope) {
        // allow the same scope only if it's the top level global/module scope
        if (!isTopLevelScope(variable.scope.variableScope)) {
            return false;
        }
    }

    return true;
}

/**
 * Checks whether or not a given variable is a type declaration.
 * @param {eslint-scope.Variable} variable - A type to check.
 * @returns {boolean} `true` if the variable is a type.
 */
function isType(variable) {
    return (
        variable.defs[0].type === "Variable" &&
        variable.defs[0].parent.kind === "type"
    );
}

/**
 * Checks whether or not a given location is inside of the range of a given node.
 *
 * @param {ASTNode} node - An node to check.
 * @param {number} location - A location to check.
 * @returns {boolean} `true` if the location is inside of the range of the node.
 */
function isInRange(node, location) {
    return node && node.range[0] <= location && location <= node.range[1];
}

/**
 * Checks whether or not a given reference is inside of the initializers of a given variable.
 *
 * This returns `true` in the following cases:
 *
 *     var a = a
 *     var [a = a] = list
 *     var {a = a} = obj
 *     for (var a in a) {}
 *     for (var a of a) {}
 *
 * @param {Variable} variable - A variable to check.
 * @param {Reference} reference - A reference to check.
 * @returns {boolean} `true` if the reference is inside of the initializers.
 */
function isInInitializer(variable, reference) {
    if (variable.scope !== reference.from) {
        return false;
    }

    let node = variable.identifiers[0].parent;
    const location = reference.identifier.range[1];

    while (node) {
        if (node.type === "VariableDeclarator") {
            if (isInRange(node.init, location)) {
                return true;
            }
            if (
                FOR_IN_OF_TYPE.test(node.parent.parent.type) &&
                isInRange(node.parent.parent.right, location)
            ) {
                return true;
            }
            break;
        } else if (node.type === "AssignmentPattern") {
            if (isInRange(node.right, location)) {
                return true;
            }
        } else if (SENTINEL_TYPE.test(node.type)) {
            break;
        }

        node = node.parent;
    }

    return false;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const defaultOptions = [
    {
        functions: true,
        classes: true,
        variables: true,
        typedefs: true,
    },
];

module.exports = {
    meta: {
        type: "problem",
        docs: {
            description:
                "Disallow the use of variables before they are defined",
            category: "Variables",
            url: util.metaDocsUrl("no-use-before-define"),
            recommended: "error",
        },
        schema: [
            {
                oneOf: [
                    {
                        enum: ["nofunc"],
                    },
                    {
                        type: "object",
                        properties: {
                            functions: { type: "boolean" },
                            classes: { type: "boolean" },
                            variables: { type: "boolean" },
                            typedefs: { type: "boolean" },
                        },
                        additionalProperties: false,
                    },
                ],
            },
        ],
    },

    create(context) {
        const options = parseOptions(
            util.applyDefault(defaultOptions, context.options)[0]
        );

        /**
         * Determines whether a given use-before-define case should be reported according to the options.
         * @param {eslint-scope.Variable} variable The variable that gets used before being defined
         * @param {eslint-scope.Reference} reference The reference to the variable
         * @returns {boolean} `true` if the usage should be reported
         */
        function isForbidden(variable, reference) {
            if (isFunction(variable)) {
                return options.functions;
            }
            if (isOuterClass(variable, reference)) {
                return options.classes;
            }
            if (isType(variable) && !options.typedefs) {
                return false;
            }
            if (isOuterVariable(variable, reference)) {
                return options.variables;
            }
            return true;
        }

        /**
         * Finds and validates all variables in a given scope.
         * @param {Scope} scope The scope object.
         * @returns {void}
         * @private
         */
        function findVariablesInScope(scope) {
            scope.references.forEach(reference => {
                const variable = reference.resolved;

                // Skips when the reference is:
                // - initialization's.
                // - referring to an undefined variable.
                // - referring to a global environment variable (there're no identifiers).
                // - located preceded by the variable (except in initializers).
                // - allowed by options.
                if (
                    reference.init ||
                    !variable ||
                    variable.identifiers.length === 0 ||
                    (variable.identifiers[0].range[1] <
                        reference.identifier.range[1] &&
                        !isInInitializer(variable, reference)) ||
                    !isForbidden(variable, reference)
                ) {
                    return;
                }

                // Reports.
                context.report({
                    node: reference.identifier,
                    message: "'{{name}}' was used before it was defined.",
                    data: reference.identifier,
                });
            });

            scope.childScopes.forEach(findVariablesInScope);
        }

        return {
            Program() {
                findVariablesInScope(context.getScope());
            },
        };
    },
};

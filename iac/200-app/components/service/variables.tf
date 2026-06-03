variable "env" {
  type        = string
  description = "Deployment environment from Spacelift."
}

variable "aws_region" {
  type        = string
  description = "AWS region for the deployment."
}

variable "service_name" {
  type        = string
  description = "Service name used for tags and resource names."
}

variable "product_name" {
  type        = string
  description = "Product name for tagging."
}

variable "pillar" {
  type        = string
  description = "Name of the pillar this resource belongs to."
}

variable "team_name" {
  type        = string
  description = "Name of the team that owns this resource."
}

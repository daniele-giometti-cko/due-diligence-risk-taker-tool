module "tags" {
  source       = "git::https://github.com/cko-world/terraform-cko-tags.git?ref=v1.0.0"
  service_name = var.service_name
  product_name = var.product_name
  pillar       = var.pillar
  team_name    = var.team_name
  env          = var.env
}
